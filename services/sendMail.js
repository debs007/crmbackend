// const nodemailer = require("nodemailer");

// const transporter = nodemailer.createTransport({
//   host: "smtp.gmail.com",
//   port: 465,
//   auth: {
//     user: process.env.SMTP_USER,
//     pass: process.env.SMTP_PASS,
//   },
// });

// async function sendMail(to, subject, body) {
//   try {
//     console.log("TO", to);
//     const info = await transporter.sendMail({
//       from: "Digital Mitro <digitalmitrous@gmail.com>",
//       to,
//       subject,
//       html: body,
//     });

//     return info;
//   } catch (err) {
//     console.error(err);
//     return false;
//   }
// }

// module.exports = { transporter, sendMail };


const nodemailer = require('nodemailer');

/**
 * Sends an email using NodeMailer.
 * @param {string} to - Recipient email address.
 * @param {string} subject - Subject of the email.
 * @param {string} text - Body of the email.
 * @returns {Promise<object>} - Promise resolving to email send status.
 */

async function sendMail(to, subject, text) {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      auth: {
        user: process.env.EMAIL_USER,  // Your Gmail address
        pass: process.env.EMAIL_PASS   // Your App Password
      }
    });

    const mailOptions = {
      from:`Digital Mitro <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, info };
  } catch (error) {
    return { success: false, error };
  }
}

module.exports = sendMail;
