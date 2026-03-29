import { NextResponse } from "next/server";
import type { Benchmarks, Headline, Strategy, MonthlyPlan } from "@/lib/types";

const SYSTEM_PROMPT = `You are a senior cotton procurement strategist and commodity analyst \
for spinning mills in South Asia (Bangladesh, India, Pakistan).

Your expertise:
- Cotton #2 ICE futures and global spot markets
- Supply/demand fundamentals: US, India, China, Brazil, West Africa
- Seasonal patterns: planting (Mar-May), growing (Jun-Sep), harvest (Oct-Dec) Northern Hemisphere
- South Asian demand: peak procurement Aug-Dec for winter/spring production runs
- Risk management: a mill running out of cotton is catastrophic — bias conservative

INSTRUCTIONS:
- Analyze the market data and news headlines holistically.
- Be specific and actionable — mills need exact tonnage guidance, not vague advice.
- Consider the client's timeline urgency vs current market conditions.
- When headlines are sparse or generic, weight statistical signals more heavily.

Return ONLY a JSON object with these fields:
{
  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "AVOID",
  "confidence": <int 0-100>,
  "executive_summary": "<2-3 sentences for the MD/CEO>",
  "market_analysis": "<3-5 paragraph markdown analysis>",
  "monthly_plan": [
    {"month": 1, "pct": <percent of total>, "rationale": "<1 sentence>"},
    ...
  ],
  "risk_factors": ["<risk>", ...],
  "next_actions": ["<action>", ...],
  "key_levels": {"support": <float>, "resistance": <float>, "fair_value": <float>}
}
The monthly_plan pct values MUST sum to 100.`;

interface StrategyRequest {
  benchmarks: Benchmarks;
  headlines: Headline[];
  company: string;
  tonnage: number;
  months: number;
}

function heuristicStrategy(
  bm: Benchmarks,
  tonnage: number,
  months: number
): Strategy {
  const rank = bm.pct_rank_1y;
  const z = bm.z_score_1y;
  const vol = bm.vol_30d_ann;

  let signal: Strategy["signal"];
  let confidence: number;

  if (rank < 0.15 && z < -1) {
    signal = "STRONG_BUY";
    confidence = 80;
  } else if (rank < 0.3) {
    signal = "BUY";
    confidence = 65;
  } else if (rank > 0.8) {
    signal = "AVOID";
    confidence = 70;
  } else {
    signal = "HOLD";
    confidence = 50;
  }

  const base = Array.from({ length: months }, (_, i) => {
    if (signal === "STRONG_BUY" || signal === "BUY")
      return Math.exp(-0.3 * i);
    if (signal === "AVOID") return Math.exp(0.3 * i);
    return 1;
  });

  if (vol > 30) {
    for (let i = 0; i < base.length; i++) {
      base[i] = 0.7 * base[i] + 0.3;
    }
  }

  const sum = base.reduce((a, b) => a + b, 0);
  const weights = base.map((b) => b / sum);

  const signalText: Record<string, string> = {
    STRONG_BUY: "Front-loaded — price is historically cheap",
    BUY: "Moderately front-loaded — attractive entry",
    AVOID: "Back-loaded — price is expensive, defer",
    HOLD: "Uniform — no strong directional signal",
  };

  const plan: MonthlyPlan[] = weights.map((w, i) => ({
    month: i + 1,
    pct: Math.round(w * 1000) / 10,
    tonnes: Math.round(tonnage * w),
    rationale: signalText[signal],
  }));

  const above50 = bm.above_ma_50d ? "above" : "below";
  const above200 = bm.above_ma_200d ? "above" : "below";
  const px = bm.current_price;

  const summaries: Record<string, string> = {
    STRONG_BUY: `Price at $${px.toFixed(4)}/lb is historically cheap (${(rank * 100).toFixed(0)}% of 1Y range). Prioritise building inventory now.`,
    BUY: `Price at $${px.toFixed(4)}/lb is moderately attractive (${(rank * 100).toFixed(0)}% of 1Y range). Increase procurement pacing.`,
    AVOID: `Price at $${px.toFixed(4)}/lb is elevated (${(rank * 100).toFixed(0)}% of 1Y range). Minimise new exposure and defer.`,
    HOLD: `Price at $${px.toFixed(4)}/lb is mid-range (${(rank * 100).toFixed(0)}% of 1Y range). Maintain baseline procurement cadence.`,
  };

  return {
    signal,
    confidence,
    executive_summary: summaries[signal],
    market_analysis:
      `**Price context**: $${px.toFixed(4)}/lb sits at the ${(rank * 100).toFixed(0)}% percentile of its ` +
      `1-year range ($${bm.low_1y.toFixed(4)} – $${bm.high_1y.toFixed(4)}). ` +
      `Z-score: ${z.toFixed(2)}. Currently ${above50} 50d MA ($${bm.ma_50d.toFixed(4)}) ` +
      `and ${above200} 200d MA ($${bm.ma_200d.toFixed(4)}).\n\n` +
      `**Momentum**: 30-day change ${bm.change_30d_pct > 0 ? "+" : ""}${bm.change_30d_pct.toFixed(1)}%, ` +
      `90-day change ${bm.change_90d_pct > 0 ? "+" : ""}${bm.change_90d_pct.toFixed(1)}%.\n\n` +
      `**Volatility**: ${vol.toFixed(1)}% annualized (30d). ` +
      `${vol > 30 ? "Elevated — spread purchases to reduce execution risk." : "Normal regime."}\n\n` +
      `*Statistical heuristic. Connect OpenAI for full AI analysis with news interpretation and strategic depth.*`,
    monthly_plan: plan,
    risk_factors: [
      "Statistical heuristic only — no news or fundamental analysis.",
      ...(vol > 30
        ? ["Elevated volatility increases execution risk on large orders."]
        : []),
      ...(rank > 0.8
        ? ["Price is near 1Y highs — basis risk is elevated."]
        : []),
    ],
    next_actions: [
      "Connect OpenAI API key for AI-powered analysis.",
      "Verify quality/count mix and wastage assumptions.",
      "Align roadmap with credit limits and warehouse capacity.",
    ],
    key_levels: {
      support: bm.low_1y,
      resistance: bm.high_1y,
      fair_value: Math.round(((bm.ma_50d + bm.ma_200d) / 2) * 10000) / 10000,
    },
    source: "heuristic",
  };
}

export async function POST(req: Request) {
  try {
    const body: StrategyRequest = await req.json();
    const { benchmarks, headlines, company, tonnage, months } = body;

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        heuristicStrategy(benchmarks, tonnage, months)
      );
    }

    const headlineSummary = headlines
      .slice(0, 25)
      .map((h) => ({ title: h.title, summary: h.summary.slice(0, 150) }));

    const userMsg = `CURRENT MARKET DATA (Cotton #2 Futures):
${JSON.stringify(benchmarks, null, 2)}

RECENT NEWS HEADLINES:
${JSON.stringify(headlineSummary, null, 2)}

CLIENT REQUIREMENT:
- Company: ${company}
- Total tonnage: ${tonnage.toLocaleString()} tonnes
- Horizon: ${months} months
- Implied monthly rate: ${Math.round(tonnage / months).toLocaleString()} tonnes/month

Analyze the market and generate a procurement strategy for this client.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      console.error("OpenAI error:", res.status, await res.text());
      return NextResponse.json(
        heuristicStrategy(benchmarks, tonnage, months)
      );
    }

    const data = await res.json();
    const text = data.choices[0].message.content.trim();

    try {
      const parsed = JSON.parse(text);
      parsed.source = "ai";
      return NextResponse.json(parsed as Strategy);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        parsed.source = "ai";
        return NextResponse.json(parsed as Strategy);
      }
      return NextResponse.json(
        heuristicStrategy(benchmarks, tonnage, months)
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
