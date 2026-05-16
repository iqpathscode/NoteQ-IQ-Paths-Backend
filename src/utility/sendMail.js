import sgMail from "@sendgrid/mail";
import { env } from "../config/env.config.js";

sgMail.setApiKey(env.SENDGRID_API_KEY);

export const sendMail = async ({
  to,
  subject,
  html,
}) => {
  try {
    console.log("========== MAIL DEBUG ==========");
    console.log("TO:", to);
    console.log("FROM:", env.EMAIL_USER);
    console.log("SUBJECT:", subject);

    const response = await sgMail.send({
      to,
      from: env.EMAIL_USER,
      subject,
      html,
    });

    console.log("MAIL SENT SUCCESS");
    console.log(response[0]?.statusCode);

  } catch (error) {
    console.log("========== MAIL ERROR ==========");

    console.log(
      JSON.stringify(
        error.response?.body || error,
        null,
        2
      )
    );
  }
};