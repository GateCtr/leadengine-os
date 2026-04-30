/**
 * Product Email Template Builder — LeadEngine OS
 *
 * Generates clean, responsive HTML email markup parameterized per product.
 * Loads product config (brandColor, logoUrl, productName, senderEmail)
 * and wraps message content with branded header, body, and footer.
 *
 * This is a pure function module — no Convex dependencies, no React Email.
 * It produces a complete HTML string ready for Resend's `html` parameter.
 *
 * Requirements: 6.2, 6.5, 17.1
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProductEmailConfig {
  /** Product display name (e.g. "Piksend") */
  productName: string;
  /** Brand hex color (e.g. "#FF6B35") */
  brandColor: string;
  /** URL of the product logo */
  logoUrl: string;
  /** Sender email for the footer (e.g. "hello@piksend.com") */
  senderEmail: string;
}

export interface EmailContent {
  /** Email subject line */
  subject: string;
  /** HTML body content of the email */
  body: string;
  /** Unsubscribe URL for GDPR/CAN-SPAM compliance */
  unsubscribeUrl: string;
}

export interface ProductEmailTemplateProps {
  product: ProductEmailConfig;
  content: EmailContent;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute a foreground color (white or dark) for text on the brand color.
 * Uses relative luminance to pick the best contrast.
 */
export function contrastTextColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  if (hex.length !== 6) return "#ffffff";

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Relative luminance (sRGB)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#1a1a1a" : "#ffffff";
}

/**
 * Escape HTML special characters to prevent XSS in template literals.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── Template Builder ────────────────────────────────────────────────────────

/**
 * Build a complete, responsive HTML email string for a given product.
 *
 * The template includes:
 * - Product logo at the top
 * - Brand-colored header accent bar
 * - Message body (HTML content passed through as-is)
 * - Footer with product name, sender email, and unsubscribe link
 *
 * The unsubscribe link is always present in the footer (Requirement 17.1).
 */
export function buildProductEmailHtml(props: ProductEmailTemplateProps): string {
  const { product, content } = props;
  const textColor = contrastTextColor(product.brandColor);
  const escapedProductName = escapeHtml(product.productName);
  const escapedSenderEmail = escapeHtml(product.senderEmail);
  const escapedLogoUrl = escapeHtml(product.logoUrl);
  const escapedUnsubscribeUrl = escapeHtml(content.unsubscribeUrl);

  return `<!DOCTYPE html>
<html lang="fr" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(content.subject)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Brand accent bar -->
          <tr>
            <td style="height:4px;background-color:${escapeHtml(product.brandColor)};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Logo -->
          <tr>
            <td align="center" style="padding:24px 32px 16px 32px;">
              <img src="${escapedLogoUrl}" alt="${escapedProductName}" width="140" height="auto" style="display:block;max-width:140px;height:auto;border:0;" />
            </td>
          </tr>
          <!-- Body content -->
          <tr>
            <td style="padding:8px 32px 24px 32px;font-size:15px;line-height:1.6;color:#374151;">
              ${content.body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e5e7eb;background-color:#fafafa;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
                    <p style="margin:0 0 8px 0;">
                      Envoyé par <strong style="color:${escapeHtml(product.brandColor)};">${escapedProductName}</strong> · ${escapedSenderEmail}
                    </p>
                    <p style="margin:0;">
                      <a href="${escapedUnsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Se désinscrire</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Preview Generator ───────────────────────────────────────────────────────

/**
 * Generate a preview-friendly HTML snippet for the Dashboard.
 *
 * This is a lighter version of the full email template, suitable for
 * rendering inside an iframe or a preview panel in the Dashboard.
 * It strips the outer document wrapper and keeps only the email card.
 *
 * Requirement: 6.5 (visual preview in Dashboard)
 */
export function buildProductEmailPreview(
  props: ProductEmailTemplateProps,
): string {
  const { product, content } = props;
  const escapedProductName = escapeHtml(product.productName);
  const escapedSenderEmail = escapeHtml(product.senderEmail);
  const escapedLogoUrl = escapeHtml(product.logoUrl);
  const escapedUnsubscribeUrl = escapeHtml(content.unsubscribeUrl);

  return `<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <div style="height:4px;background-color:${escapeHtml(product.brandColor)};"></div>
  <div style="text-align:center;padding:24px 32px 16px 32px;">
    <img src="${escapedLogoUrl}" alt="${escapedProductName}" style="max-width:140px;height:auto;" />
  </div>
  <div style="padding:8px 32px 24px 32px;font-size:15px;line-height:1.6;color:#374151;">
    ${content.body}
  </div>
  <div style="padding:20px 32px;border-top:1px solid #e5e7eb;background-color:#fafafa;text-align:center;font-size:12px;color:#6b7280;">
    <p style="margin:0 0 8px 0;">Envoyé par <strong style="color:${escapeHtml(product.brandColor)};">${escapedProductName}</strong> · ${escapedSenderEmail}</p>
    <p style="margin:0;"><a href="${escapedUnsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Se désinscrire</a></p>
  </div>
</div>`;
}

/**
 * Convenience function: render a full product email from template props.
 * Returns the complete HTML string ready for Resend's `html` parameter.
 *
 * This is the main entry point used by sendApprovedEmail.
 */
export function renderProductEmail(props: ProductEmailTemplateProps): string {
  return buildProductEmailHtml(props);
}
