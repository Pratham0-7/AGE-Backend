const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const axios = require("axios");
const cron = require("node-cron");

const app = express();

require("dotenv").config();

app.use(cors());
app.use(express.json());

/* ================= STORAGE ================= */

let responses = {}; // { leadId: "yes" | "no" }
let emailsSent = 0;

let leads = []; // lead database for followups

/* ================= EMAIL CONFIG ================= */

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((error) => {
  if (error) {
    console.log("SMTP ERROR:", error);
  } else {
    console.log("SMTP READY");
  }
});

/* ================= FOLLOWUP SCHEDULE ================= */

const FOLLOWUPS = [
  { delay: 0, subject: "Program Details" },
  { delay: 2, subject: "Just checking in" },
  { delay: 5, subject: "Quick reminder" },
  { delay: 10, subject: "Last follow-up" },
];

/* ================= SEND EMAIL ROUTE ================= */

app.post("/send-email", async (req, res) => {
  const { emails, subject, message, leadId } = req.body;

  try {
    for (const email of emails) {
      await transporter.sendMail({
        from: "076pandeypratham@gmail.com",
        to: email,
        subject: subject || "AGE Follow Up",
        html: message,
      });

      emailsSent++;

      /* store lead for followups */

      if (leadId) {
        leads.push({
          id: leadId,
          email: email,
          stage: 0,
          nextFollowup: Date.now() + FOLLOWUPS[1].delay * 86400000,
          status: "pending",
          message,
        });
      }
    }

    res.send({ success: true });
  } catch (err) {
    console.log("EMAIL ERROR:", err);

    res.send({ success: false });
  }
});

/* ================= FOLLOWUP CRON ================= */

/* runs every minute */

cron.schedule("* * * * *", async () => {
  const now = Date.now();

  for (const lead of leads) {
    if (lead.status !== "pending") continue;

    if (lead.nextFollowup <= now) {
      const stage = lead.stage + 1;

      if (stage >= FOLLOWUPS.length) {
        lead.status = "completed";
        continue;
      }

      try {
        await transporter.sendMail({
          from: "076pandeypratham@gmail.com",
          to: lead.email,
          subject: FOLLOWUPS[stage].subject,
          html: lead.message,
        });

        emailsSent++;

        lead.stage = stage;

        lead.nextFollowup = Date.now() + FOLLOWUPS[stage].delay * 86400000;

        console.log("Follow-up sent:", lead.email);
      } catch (err) {
        console.log("FOLLOWUP ERROR:", err);
      }
    }
  }
});

/* ================= SMS ROUTE ================= */

app.post("/send-sms", async (req, res) => {
  const { phones, message } = req.body;

  try {
    for (const phone of phones) {
      const response = await axios.post("https://textbelt.com/text", {
        phone,
        message,
        key: "textbelt",
      });

      console.log("SMS RESPONSE:", response.data);
    }

    res.send({ success: true });
  } catch (err) {
    console.log("SMS ERROR:", err);

    res.send({ success: false });
  }
});

/* ================= TITLE EXTRACT ================= */

app.post("/extract-title", async (req, res) => {
  const { url } = req.body;

  try {
    const response = await axios.get(url);

    const html = response.data;

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);

    let title = null;

    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim();
    }

    res.send({ title });
  } catch (err) {
    console.log("TITLE FETCH ERROR:", err);

    res.send({ title: null });
  }
});

/* ================= RESPONSE TRACKING ================= */

app.get("/response", (req, res) => {
  const { lead, status } = req.query;

  if (!lead || !status) {
    return res.send("Invalid response");
  }

  responses[lead] = status;

  /* stop followups */

  const leadData = leads.find((l) => l.id === lead);

  if (leadData) {
    leadData.status = status;
  }

  console.log(`Lead ${lead} responded: ${status}`);

  res.send(`
  <html>
    <body style="font-family:Arial;text-align:center;margin-top:80px">
      <h2>Thanks! Your response has been recorded.</h2>
      <p>Our team will reach out to you shortly.</p>
    </body>
  </html>
  `);
});

/* ================= FETCH RESPONSES ================= */

app.get("/responses", (req, res) => {
  res.json(responses);
});

/* ================= STATS ================= */

app.get("/stats", (req, res) => {
  const responseCount = Object.keys(responses).length;

  const interested = Object.values(responses).filter((r) => r === "yes").length;

  const conversionRate =
    emailsSent === 0 ? 0 : Math.round((interested / emailsSent) * 100);

  res.json({
    emailsSent,
    responses: responseCount,
    interested,
    conversionRate,
  });
});

/* ================= SERVER START ================= */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("AGE backend running on port " + PORT);
});
