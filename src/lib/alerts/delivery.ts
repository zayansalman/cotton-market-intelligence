/**
 * Alert delivery channels (#8).
 *
 * Webhook (covers Slack, Discord, custom endpoints) and email
 * (via configurable SMTP/API). Delivery failures are logged
 * and retriable.
 */

import type { AlertPayload, AlertChannel } from "./types";
import { fetchWithTimeout } from "@/lib/api-security";

/* ------------------------------------------------------------------ */
/*  Delivery result                                                    */
/* ------------------------------------------------------------------ */

export interface DeliveryResult {
  channel_type: string;
  success: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Deliver to a single channel                                        */
/* ------------------------------------------------------------------ */

export async function deliverAlert(
  payload: AlertPayload,
  channel: AlertChannel
): Promise<DeliveryResult> {
  try {
    switch (channel.type) {
      case "webhook":
        return await deliverWebhook(payload, channel.url, channel.headers);
      case "email":
        return await deliverEmail(payload, channel.to);
      default:
        return { channel_type: "unknown", success: false, error: "Unknown channel type" };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delivery failed";
    console.error(`[alert-delivery] ${channel.type} failed:`, msg);
    return { channel_type: channel.type, success: false, error: msg };
  }
}

/* ------------------------------------------------------------------ */
/*  Webhook delivery (Slack, Discord, custom)                          */
/* ------------------------------------------------------------------ */

async function deliverWebhook(
  payload: AlertPayload,
  url: string,
  headers?: Record<string, string>
): Promise<DeliveryResult> {
  // Format for Slack-compatible webhook
  const body = isSlackUrl(url)
    ? formatSlackPayload(payload)
    : JSON.stringify(payload);

  const res = await fetchWithTimeout(url, {
    method: "POST",
    timeout: 10_000,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[alert-delivery] Webhook ${res.status}: ${text.slice(0, 200)}`);
    return {
      channel_type: "webhook",
      success: false,
      error: `HTTP ${res.status}`,
    };
  }

  return { channel_type: "webhook", success: true };
}

function isSlackUrl(url: string): boolean {
  return url.includes("hooks.slack.com");
}

function formatSlackPayload(payload: AlertPayload): string {
  const emoji =
    payload.signal === "STRONG_BUY" || payload.signal === "BUY"
      ? ":chart_with_upwards_trend:"
      : payload.signal === "AVOID"
        ? ":chart_with_downwards_trend:"
        : ":bar_chart:";

  return JSON.stringify({
    text: `${emoji} *CMI Alert: ${payload.rule_name}*`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `${emoji} *${payload.rule_name}*\n` +
            `> ${payload.message}\n\n` +
            `*Signal:* ${payload.signal} (${payload.confidence}%)\n` +
            `*Price:* $${payload.price.toFixed(4)}/lb\n` +
            `*Vol 30d:* ${payload.vol_30d.toFixed(1)}%\n` +
            `*Action:* ${payload.recommended_action}`,
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/*  Email delivery (via env-configured endpoint)                       */
/* ------------------------------------------------------------------ */

async function deliverEmail(
  payload: AlertPayload,
  to: string
): Promise<DeliveryResult> {
  const emailApiUrl = process.env.ALERT_EMAIL_API_URL;
  const emailApiKey = process.env.ALERT_EMAIL_API_KEY;

  if (!emailApiUrl) {
    console.warn("[alert-delivery] Email not configured (ALERT_EMAIL_API_URL not set)");
    return {
      channel_type: "email",
      success: false,
      error: "Email delivery not configured",
    };
  }

  const subject = `CMI Alert: ${payload.rule_name} — ${payload.signal}`;
  const body = [
    payload.message,
    "",
    `Signal: ${payload.signal} (${payload.confidence}% confidence)`,
    `Price: $${payload.price.toFixed(4)}/lb (${payload.price_date})`,
    `Volatility: ${payload.vol_30d.toFixed(1)}% (30d annualized)`,
    `1Y Percentile: ${(payload.pct_rank_1y * 100).toFixed(0)}%`,
    "",
    `Recommended action: ${payload.recommended_action}`,
    "",
    "— Cotton Market Intelligence",
  ].join("\n");

  const res = await fetchWithTimeout(emailApiUrl, {
    method: "POST",
    timeout: 10_000,
    headers: {
      "Content-Type": "application/json",
      ...(emailApiKey ? { Authorization: `Bearer ${emailApiKey}` } : {}),
    },
    body: JSON.stringify({ to, subject, text: body }),
  });

  if (!res.ok) {
    return {
      channel_type: "email",
      success: false,
      error: `HTTP ${res.status}`,
    };
  }

  return { channel_type: "email", success: true };
}

/* ------------------------------------------------------------------ */
/*  Deliver to all channels for an alert                               */
/* ------------------------------------------------------------------ */

export async function deliverToAllChannels(
  payload: AlertPayload,
  channels: AlertChannel[]
): Promise<DeliveryResult[]> {
  return Promise.all(channels.map((ch) => deliverAlert(payload, ch)));
}
