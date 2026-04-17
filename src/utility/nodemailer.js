// import nodemailer from "nodemailer";

// const transporter = nodemailer.createTransport({
//   service: "gmail",
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });

// await transporter.sendMail({
//   from: process.env.EMAIL_USER,
//   to: user.email,
//   subject: "Reset Password Link",
//   html: `
//     <h3>Password Reset Request</h3>
//     <p>Click below link to reset your password:</p>
//     <a href="${resetLink}">${resetLink}</a>
//     <p>This link expires in 15 minutes.</p>
//   `,
// });