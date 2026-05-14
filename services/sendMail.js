const nodemailer = require("nodemailer");

// Builds a professional HTML email template.
// `type` can be "otp", "notification", or "plain".
const buildHtml = (subject, body, type = "plain") => {
  const year = new Date().getFullYear();
  const logoUrl = "https://res.cloudinary.com/dinitjlyf/image/upload/v1/logo.png";

  const contentBlock =
    type === "otp"
      ? `
        <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
          You requested to log in to <strong>Digital Mitro CRM</strong>. Use the
          one-time password below. It is valid for <strong>5 minutes</strong>.
        </p>
        <div style="text-align:center;margin:28px 0;">
          <div style="display:inline-block;background:#F3F4F6;border:2px dashed #9CA3AF;
                      border-radius:10px;padding:18px 48px;">
            <span style="font-size:36px;font-weight:900;letter-spacing:10px;
                         color:#4A154B;font-family:monospace;">${body}</span>
          </div>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#6B7280;text-align:center;">
          Do not share this code with anyone.
        </p>
        <p style="margin:0;font-size:13px;color:#6B7280;text-align:center;">
          If you did not request this, you can safely ignore this email.
        </p>`
      : `<p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">${body}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:Lato,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#F9FAFB;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:560px;margin:0 auto;">

          <!-- Header -->
          <tr>
            <td style="background:#4A154B;border-radius:10px 10px 0 0;padding:24px 32px;text-align:center;">
              <h1 style="margin:0;font-size:22px;font-weight:900;color:#FFFFFF;letter-spacing:1px;">
                Digital Mitro CRM
              </h1>
              <p style="margin:4px 0 0;font-size:12px;color:#C4A8C6;letter-spacing:0.5px;text-transform:uppercase;">
                Workspace Platform
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#FFFFFF;padding:36px 32px;">
              <h2 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1D1C1D;">
                ${subject}
              </h2>
              ${contentBlock}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F3F4F6;border-radius:0 0 10px 10px;padding:20px 32px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#9CA3AF;">
                Digital Mitro CRM &bull; Automated email — do not reply
              </p>
              <p style="margin:0;font-size:11px;color:#D1D5DB;">
                &copy; ${year} Digital Mitro. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Sends a transactional email.
 * @param {string} to
 * @param {string} subject
 * @param {string} text - plain-text body OR an OTP code (if type="otp")
 * @param {"otp"|"notification"|"plain"} [type="plain"]
 */
async function sendMail(to, subject, text, type = "plain") {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `Digital Mitro CRM <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text: typeof text === "string" ? text : String(text),
      html: buildHtml(subject, typeof text === "string" ? text : String(text), type),
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, info };
  } catch (error) {
    console.error("sendMail error:", error?.message);
    return { success: false, error };
  }
}

module.exports = sendMail;
