import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

/**
 * Short URL redirect and tracking route.
 *
 * Resolves a short code to its original URL, checks the blacklist,
 * records a tracking event (click), and redirects to the original URL.
 * Blacklisted leads are redirected without tracking.
 *
 * Requirements: 18.2, 18.4
 */
http.route({
  pathPrefix: "/t/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    // Extract the short code from the URL path
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    // pathPrefix "/t/" means pathname is "/t/{code}" → parts = ["", "t", "{code}"]
    const code = pathParts[2];

    if (!code || code.length === 0) {
      return new Response("Not Found", { status: 404 });
    }

    // Resolve the short code
    const shortUrl = await ctx.runQuery(
      internal.tracking.shortUrls.resolveShortUrl,
      { code },
    );

    if (!shortUrl) {
      return new Response("Not Found", { status: 404 });
    }

    // Check if the lead is blacklisted (Requirement 18.4)
    const isBlacklisted: boolean = await ctx.runQuery(
      internal.tracking.redirect.isLeadBlacklisted,
      { leadId: shortUrl.leadId },
    );

    if (!isBlacklisted) {
      // Record the click event (Requirement 18.2)
      await ctx.runMutation(internal.tracking.shortUrls.recordClick, {
        shortUrlId: shortUrl._id,
        leadId: shortUrl.leadId,
        messageId: shortUrl.messageId,
        originalUrl: shortUrl.originalUrl,
      });
    }

    // Redirect to the original URL regardless of blacklist status
    return new Response(null, {
      status: 302,
      headers: { Location: shortUrl.originalUrl },
    });
  }),
});

/**
 * Webhook product route — receives inbound product webhook events.
 *
 * Validates:
 * 1. Webhook authenticity via X-Webhook-Secret header
 * 2. Payload structure (product_id, event_type, event_context, user_email, timestamp)
 * 3. product_id against active products in the `products` table
 *
 * On success: stores the event in `webhook_events` and returns HTTP 200.
 * On auth failure: returns HTTP 401.
 * On validation failure: stores the error in `webhook_events` and returns HTTP 400.
 *
 * Requirements: 2.1, 2.3, 2.4
 */
http.route({
  path: "/webhooks/product",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const receivedAt = Date.now();

    // 1. Validate webhook authenticity (Requirement 2.4)
    const webhookSecret = process.env.WEBHOOK_SECRET;
    const providedSecret = request.headers.get("X-Webhook-Secret");

    if (!webhookSecret || providedSecret !== webhookSecret) {
      // Store failed auth attempt for observability
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: "unknown",
        eventType: "auth_failed",
        payload: null,
        processed: false,
        error: "Invalid or missing X-Webhook-Secret header",
        receivedAt,
      });

      return new Response(
        JSON.stringify({ error: "Unauthorized: invalid webhook secret" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2. Parse JSON body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: "unknown",
        eventType: "parse_error",
        payload: null,
        processed: false,
        error: "Invalid JSON body",
        receivedAt,
      });

      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 3. Validate payload structure (Requirement 2.3)
    const validationError = validatePayloadStructure(body);
    if (validationError) {
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: "unknown",
        eventType: "validation_error",
        payload: body,
        processed: false,
        error: validationError,
        receivedAt,
      });

      return new Response(
        JSON.stringify({ error: validationError }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // At this point body is validated structurally
    const payload = body as {
      product_id: string;
      event_type: string;
      event_context: string;
      user_email: string;
      timestamp: number;
    };

    // 4. Validate product_id against active products (Requirement 2.1, 2.3)
    const activeProductSlugs: string[] = await ctx.runQuery(
      internal.webhooks.getActiveProductSlugs,
    );

    if (!activeProductSlugs.includes(payload.product_id)) {
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: payload.product_id,
        eventType: payload.event_type,
        payload,
        processed: false,
        error: `Invalid product_id: "${payload.product_id}" does not match any active product`,
        receivedAt,
      });

      return new Response(
        JSON.stringify({
          error: `Invalid product_id: "${payload.product_id}" does not match any active product`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 5. Store the valid webhook event (Requirement 2.1)
    const eventId = await ctx.runMutation(
      internal.webhooks.storeWebhookEvent,
      {
        source: payload.product_id,
        eventType: payload.event_type,
        payload,
        processed: false,
        receivedAt,
      },
    );

    // 6. Create or consolidate lead from webhook (Requirement 2.1, 2.2)
    const leadId = await ctx.runMutation(
      internal.webhooks.createLeadFromWebhook,
      {
        productId: payload.product_id,
        eventType: payload.event_type,
        eventContext: payload.event_context,
        userEmail: payload.user_email,
        timestamp: payload.timestamp,
      },
    );

    // 7. Mark webhook event as processed
    await ctx.runMutation(internal.webhooks.markWebhookProcessed, {
      eventId,
    });

    return new Response(
      JSON.stringify({ success: true, eventId, leadId }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

/**
 * Validates the structural integrity of a webhook payload.
 * Returns an error message string if invalid, or null if valid.
 *
 * Required fields:
 * - product_id: string (non-empty)
 * - event_type: string (non-empty)
 * - event_context: string
 * - user_email: string (basic email format)
 * - timestamp: number
 */
function validatePayloadStructure(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "Payload must be a JSON object";
  }

  const payload = body as Record<string, unknown>;

  // Check required fields exist and have correct types
  const requiredFields: Array<{
    key: string;
    type: string;
    validate?: (val: unknown) => string | null;
  }> = [
    {
      key: "product_id",
      type: "string",
      validate: (val) =>
        typeof val === "string" && val.length === 0
          ? "product_id must be a non-empty string"
          : null,
    },
    {
      key: "event_type",
      type: "string",
      validate: (val) =>
        typeof val === "string" && val.length === 0
          ? "event_type must be a non-empty string"
          : null,
    },
    {
      key: "event_context",
      type: "string",
    },
    {
      key: "user_email",
      type: "string",
      validate: (val) => {
        if (typeof val !== "string") return null; // type check handles this
        // Basic email validation: must contain @ with text on both sides
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
          return "user_email must be a valid email address";
        }
        return null;
      },
    },
    {
      key: "timestamp",
      type: "number",
      validate: (val) => {
        if (typeof val !== "number") return null;
        if (!Number.isFinite(val)) {
          return "timestamp must be a finite number";
        }
        return null;
      },
    },
  ];

  const missingFields: string[] = [];
  const typeErrors: string[] = [];

  for (const field of requiredFields) {
    if (!(field.key in payload)) {
      missingFields.push(field.key);
      continue;
    }

    const value = payload[field.key];

    if (typeof value !== field.type) {
      typeErrors.push(
        `${field.key} must be of type ${field.type}, got ${typeof value}`,
      );
      continue;
    }

    if (field.validate) {
      const error = field.validate(value);
      if (error) {
        typeErrors.push(error);
      }
    }
  }

  if (missingFields.length > 0) {
    return `Missing required fields: ${missingFields.join(", ")}`;
  }

  if (typeErrors.length > 0) {
    return typeErrors.join("; ");
  }

  return null;
}

/**
 * Stripe webhook route — receives payment events from Stripe.
 *
 * Pipeline:
 * 1. Read the raw body (required for signature verification)
 * 2. Extract the Stripe-Signature header
 * 3. Delegate to the processStripeWebhook action (Node.js runtime)
 *    which verifies the signature, processes the event, and updates leads
 *
 * Returns HTTP 200 on success, HTTP 400 on invalid signature/payload.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const receivedAt = Date.now();

    // 1. Read the raw body as text (required for Stripe signature verification)
    const rawBody = await request.text();

    // 2. Extract the Stripe-Signature header
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: "stripe",
        eventType: "missing_signature",
        payload: null,
        processed: false,
        error: "Missing Stripe-Signature header",
        receivedAt,
      });

      return new Response(
        JSON.stringify({ error: "Missing Stripe-Signature header" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 3. Delegate to the Node.js action for signature verification and processing
    const result = await ctx.runAction(
      internal.stripeWebhook.processStripeWebhook,
      { rawBody, signature, receivedAt },
    );

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

/**
 * Resend inbound email webhook route — receives inbound email replies from prospects.
 *
 * Pipeline:
 * 1. Parse the Resend inbound webhook payload (from, text/html)
 * 2. Extract the sender email and reply content
 * 3. Delegate to `processInboundReply` mutation which:
 *    - Finds the lead by email
 *    - Updates the most recent message with replyContent and replyReceivedAt
 *    - Schedules the Agent Objecteur
 *
 * Returns HTTP 200 on success, HTTP 400 on invalid payload, HTTP 404 if no matching lead.
 *
 * Requirements: 10.1
 */
http.route({
  path: "/webhooks/resend/inbound",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const receivedAt = Date.now();

    // 1. Parse JSON body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: "resend",
        eventType: "inbound_parse_error",
        payload: null,
        processed: false,
        error: "Invalid JSON body",
        receivedAt,
      });

      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2. Validate payload structure
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: "resend",
        eventType: "inbound_validation_error",
        payload: body,
        processed: false,
        error: "Payload must be a JSON object",
        receivedAt,
      });

      return new Response(
        JSON.stringify({ error: "Payload must be a JSON object" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const payload = body as Record<string, unknown>;

    // 3. Extract and validate required fields
    const from = payload.from;
    const text = payload.text;
    const html = payload.html;

    if (typeof from !== "string" || from.length === 0) {
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: "resend",
        eventType: "inbound_validation_error",
        payload: body,
        processed: false,
        error: "Missing or invalid 'from' field",
        receivedAt,
      });

      return new Response(
        JSON.stringify({ error: "Missing or invalid 'from' field" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Extract the reply content: prefer plain text, fall back to HTML
    const replyContent =
      typeof text === "string" && text.length > 0
        ? text
        : typeof html === "string" && html.length > 0
          ? html
          : null;

    if (!replyContent) {
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: "resend",
        eventType: "inbound_validation_error",
        payload: body,
        processed: false,
        error: "Missing reply content: both 'text' and 'html' are empty or missing",
        receivedAt,
      });

      return new Response(
        JSON.stringify({ error: "Missing reply content: both 'text' and 'html' are empty or missing" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 4. Extract the email address from the "from" field
    // Resend may send "Name <email@example.com>" or just "email@example.com"
    const emailMatch = from.match(/<([^>]+)>/);
    const senderEmail = emailMatch ? emailMatch[1] : from.trim();

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(senderEmail)) {
      await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
        source: "resend",
        eventType: "inbound_validation_error",
        payload: body,
        processed: false,
        error: `Invalid sender email format: "${senderEmail}"`,
        receivedAt,
      });

      return new Response(
        JSON.stringify({ error: `Invalid sender email format: "${senderEmail}"` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 5. Store the webhook event
    const eventId = await ctx.runMutation(internal.webhooks.storeWebhookEvent, {
      source: "resend",
      eventType: "inbound_email",
      payload: body,
      processed: false,
      receivedAt,
    });

    // 6. Process the inbound reply
    const result = await ctx.runMutation(internal.webhooks.processInboundReply, {
      senderEmail,
      replyContent,
    });

    // 7. Mark webhook event as processed
    await ctx.runMutation(internal.webhooks.markWebhookProcessed, {
      eventId,
    });

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.reason }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId: result.messageId,
        leadId: result.leadId,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

/**
 * Testimonial submission route — receives testimonials from converted leads.
 *
 * Pipeline:
 * 1. Parse the JSON body (content, authorName)
 * 2. Decode the lead identifier from the `id` query parameter (base64-encoded leadId)
 * 3. Validate the lead exists and has a productId
 * 4. Store the testimonial via `submitTestimonial` mutation
 * 5. Return an HTML confirmation page
 *
 * The testimonial link format is: /testimonial?id={base64_encoded_leadId}
 *
 * Requirements: 19.1
 */
http.route({
  path: "/testimonial",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const encodedId = url.searchParams.get("id");

    if (!encodedId) {
      return new Response(
        buildTestimonialFormHtml(null, null, "Lien invalide."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    let leadId: string;
    try {
      leadId = atob(decodeURIComponent(encodedId));
    } catch {
      return new Response(
        buildTestimonialFormHtml(null, null, "Lien invalide."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    // Load lead and product info for the form
    const leadInfo = await ctx.runQuery(
      internal.testimonials.getLeadInfoForForm,
      { leadId: leadId as Id<"leads"> },
    );

    if (!leadInfo) {
      return new Response(
        buildTestimonialFormHtml(null, null, "Lien invalide ou expiré."),
        { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    return new Response(
      buildTestimonialFormHtml(encodedId, leadInfo.productName),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }),
});

http.route({
  path: "/testimonial",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const encodedId = url.searchParams.get("id");

    if (!encodedId) {
      return new Response(
        JSON.stringify({ error: "Missing id parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let leadId: string;
    try {
      leadId = atob(decodeURIComponent(encodedId));
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid id parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return new Response(
        JSON.stringify({ error: "Payload must be a JSON object" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const payload = body as Record<string, unknown>;
    const content = payload.content;
    const authorName = payload.authorName;

    if (typeof content !== "string" || content.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing or empty 'content' field" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Store the testimonial
    const result = await ctx.runMutation(
      internal.testimonials.submitTestimonialFromHttp,
      {
        leadId: leadId as Id<"leads">,
        content: content.trim(),
        authorName: typeof authorName === "string" && authorName.trim().length > 0
          ? authorName.trim()
          : undefined,
      },
    );

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      buildTestimonialThankYouHtml(),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }),
});

/**
 * Build the HTML testimonial submission form.
 */
function buildTestimonialFormHtml(
  encodedId: string | null,
  productName: string | null,
  errorMessage?: string,
): string {
  if (errorMessage || !encodedId) {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Erreur</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
    .card { max-width: 480px; padding: 48px 32px; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { font-size: 14px; color: #6b7280; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Lien invalide</h1>
    <p>${errorMessage ?? "Ce lien de témoignage n'est pas valide."}</p>
  </div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Partagez votre expérience — ${productName ?? "LeadEngine"}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
    .card { max-width: 520px; width: 100%; padding: 40px 32px; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { font-size: 22px; margin: 0 0 8px; }
    .subtitle { font-size: 14px; color: #6b7280; margin: 0 0 24px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    textarea, input { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; box-sizing: border-box; }
    textarea { min-height: 120px; resize: vertical; }
    textarea:focus, input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
    .field { margin-bottom: 16px; }
    button { width: 100%; padding: 12px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:hover { background: #2563eb; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .error { color: #dc2626; font-size: 13px; margin-top: 8px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Partagez votre expérience</h1>
    <p class="subtitle">Votre témoignage sur ${productName ?? "notre produit"} aidera d'autres professionnels.</p>
    <form id="testimonialForm">
      <div class="field">
        <label for="authorName">Votre nom (optionnel)</label>
        <input type="text" id="authorName" name="authorName" placeholder="Jean Dupont" />
      </div>
      <div class="field">
        <label for="content">Votre témoignage *</label>
        <textarea id="content" name="content" placeholder="Décrivez votre expérience, ce qui a changé pour vous, les résultats obtenus…" required></textarea>
      </div>
      <button type="submit" id="submitBtn">Envoyer mon témoignage</button>
      <p class="error" id="errorMsg"></p>
    </form>
  </div>
  <script>
    document.getElementById('testimonialForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('submitBtn');
      var errorEl = document.getElementById('errorMsg');
      btn.disabled = true;
      btn.textContent = 'Envoi en cours…';
      errorEl.style.display = 'none';
      try {
        var res = await fetch(window.location.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: document.getElementById('content').value,
            authorName: document.getElementById('authorName').value || undefined
          })
        });
        if (res.ok) {
          var html = await res.text();
          document.open();
          document.write(html);
          document.close();
        } else {
          var data = await res.json();
          errorEl.textContent = data.error || 'Une erreur est survenue.';
          errorEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Envoyer mon témoignage';
        }
      } catch(err) {
        errorEl.textContent = 'Erreur réseau. Veuillez réessayer.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Envoyer mon témoignage';
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Build the HTML thank-you page shown after a testimonial is submitted.
 */
function buildTestimonialThankYouHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Merci pour votre témoignage</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
    .card { max-width: 480px; padding: 48px 32px; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { font-size: 14px; color: #6b7280; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🙏</div>
    <h1>Merci pour votre témoignage !</h1>
    <p>Votre retour est précieux. Notre équipe le validera prochainement et il pourra être utilisé pour aider d'autres professionnels.</p>
  </div>
</body>
</html>`;
}

/**
 * Unsubscribe route — handles opt-out clicks from email footers.
 *
 * Pipeline:
 * 1. Extract the `id` query parameter (base64-encoded email)
 * 2. Decode and validate the email address
 * 3. Add the email to the blacklist via `addToBlacklist` (idempotent)
 * 4. Return an HTML confirmation page
 *
 * The unsubscribe link format is: /unsubscribe?id={base64_encoded_email}
 * Generated by `buildUnsubscribeUrl` in `convex/integrations/resend.ts`.
 *
 * Requirements: 17.1, 17.2
 */
http.route({
  path: "/unsubscribe",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const encodedId = url.searchParams.get("id");

    if (!encodedId) {
      return new Response(buildUnsubscribeHtml(false, "Lien de désinscription invalide."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    let email: string;
    try {
      email = atob(decodeURIComponent(encodedId));
    } catch {
      return new Response(buildUnsubscribeHtml(false, "Lien de désinscription invalide."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(buildUnsubscribeHtml(false, "Adresse email invalide."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    await ctx.runMutation(internal.compliance.blacklist.addToBlacklist, {
      email,
      reason: "unsubscribe",
    });

    return new Response(buildUnsubscribeHtml(true), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }),
});

/**
 * Build the HTML page shown after an unsubscribe action.
 *
 * On success: confirmation that the email has been removed from all lists.
 * On failure: an error message explaining what went wrong.
 */
function buildUnsubscribeHtml(success: boolean, errorMessage?: string): string {
  const title = success ? "Désinscription confirmée" : "Erreur de désinscription";
  const heading = success
    ? "Vous avez été désinscrit avec succès"
    : "Impossible de traiter votre demande";
  const body = success
    ? "Votre adresse email a été retirée de nos listes de diffusion. Vous ne recevrez plus aucun email de notre part."
    : errorMessage ?? "Une erreur est survenue lors du traitement de votre demande.";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background-color: #f9fafb;
      color: #111827;
    }
    .card {
      max-width: 480px;
      padding: 48px 32px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      text-align: center;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { font-size: 14px; color: #6b7280; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? "✅" : "⚠️"}</div>
    <h1>${heading}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
}

export default http;
