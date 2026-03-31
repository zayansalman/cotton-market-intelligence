import { NextResponse } from "next/server";
import type { Headline } from "@/lib/types";
import {
  applyRateLimitHeaders,
  evaluateRequestRateLimit,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

const RSS_FEEDS = [
  "https://www.cottongrower.com/feed/",
  "https://www.textileworld.com/feed/",
  "https://www.usda.gov/rss/latest-news.xml",
  "https://blogs.worldbank.org/en/topic/agriculture/rss.xml",
];

function extractText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${tag}>`, "s");
  const match = xml.match(regex);
  return match?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
}

function parseRSS(xml: string): Headline[] {
  const items: Headline[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractText(block, "title"),
      summary: extractText(block, "description").slice(0, 300),
      link: extractText(block, "link"),
      published: extractText(block, "pubDate"),
    });
    if (items.length >= 12) break;
  }
  return items;
}

export async function GET(req: Request) {
  const rateLimit = evaluateRequestRateLimit(req, "headlines");
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit);
  }

  const allHeadlines: Headline[] = [];

  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (url) => {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        next: { revalidate: 1800 },
      });
      if (!res.ok) return [];
      const xml = await res.text();
      return parseRSS(xml);
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      allHeadlines.push(...r.value);
    }
  }

  return applyRateLimitHeaders(
    NextResponse.json(allHeadlines.slice(0, 40)),
    rateLimit.headers
  );
}
