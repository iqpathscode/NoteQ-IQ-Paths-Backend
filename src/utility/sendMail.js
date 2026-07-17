import SibApiV3Sdk from "sib-api-v3-sdk";
import { env } from "../config/env.config.js";

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

export const sendMail = async ({ to, subject, html, name = "" }) => {
  try {
    console.log("========== MAIL DEBUG ==========");
    console.log("TO:", to);
    console.log("FROM:", env.BREVO_SENDER_EMAIL);
    console.log("SUBJECT:", subject);

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    sendSmtpEmail.sender = {
      name: env.BREVO_SENDER_NAME || "IQPaths",
      email: env.BREVO_SENDER_EMAIL,
    };

    sendSmtpEmail.to = [{ email: to, name: name || " " }];
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;

    const response = await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log("MAIL SENT SUCCESS");
    console.log("Status:", response?.response?.statusCode);

  } catch (error) {
    console.log("========== MAIL ERROR ==========");
    console.log(JSON.stringify(error.response?.body || error, null, 2));
  }
};