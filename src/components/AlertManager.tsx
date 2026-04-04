"use client";

import { useState, useEffect, useCallback } from "react";
import type { AlertRule, AlertChannel, AlertTrigger, AlertPayload } from "@/lib/alerts/types";
import type { Benchmarks, Strategy } from "@/lib/types";
import { loadRules, saveRules, loadAlertState, saveAlertState, generateRuleId } from "@/lib/alerts/store";
import { evaluateAllRules, updateAlertState } from "@/lib/alerts/engine";
import { deliverToAllChannels } from "@/lib/alerts/delivery";

interface Props {
  benchmarks: Benchmarks | undefined;
  strategy: Strategy | null | undefined;
}

const TRIGGER_LABELS: Record<AlertTrigger, string> = {
  signal_change: "Signal Change",
  volatility_breach: "Volatility Breach",
  key_level_break: "Key Level Break",
  price_threshold: "Price Threshold",
};

export default function AlertManager({ benchmarks, strategy }: Props) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [firedAlerts, setFiredAlerts] = useState<AlertPayload[]>([]);
  const [adding, setAdding] = useState(false);

  // New rule form state
  const [newTrigger, setNewTrigger] = useState<AlertTrigger>("signal_change");
  const [newName, setNewName] = useState("");
  const [newVolThreshold, setNewVolThreshold] = useState(30);
  const [newPriceLevel, setNewPriceLevel] = useState(0.70);
  const [newPriceDirection, setNewPriceDirection] = useState<"above" | "below">("below");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    setRules(loadRules());
  }, []);

  useEffect(() => {
    if (rules.length > 0) saveRules(rules);
  }, [rules]);

  // Evaluate rules when strategy changes
  useEffect(() => {
    if (!benchmarks || !strategy || rules.length === 0) return;

    const state = loadAlertState();
    const alerts = evaluateAllRules(rules, benchmarks, strategy, state);

    if (alerts.length > 0) {
      setFiredAlerts((prev) => [...alerts, ...prev].slice(0, 20));
      // Deliver alerts
      for (const alert of alerts) {
        const rule = rules.find((r) => r.id === alert.rule_id);
        if (rule) {
          deliverToAllChannels(alert, rule.channels).then((results) => {
            for (const r of results) {
              if (!r.success) {
                console.warn(`[alerts] Delivery failed: ${r.channel_type} — ${r.error}`);
              }
            }
          });
        }
      }
    }

    const newState = updateAlertState(state, benchmarks, strategy);
    saveAlertState(newState);
  }, [benchmarks, strategy, rules]);

  const addRule = useCallback(() => {
    const channels: AlertChannel[] = [];
    if (newWebhookUrl) channels.push({ type: "webhook", url: newWebhookUrl });
    if (newEmail) channels.push({ type: "email", to: newEmail });

    const configMap: Record<AlertTrigger, () => AlertRule["config"]> = {
      signal_change: () => ({ type: "signal_change" }),
      volatility_breach: () => ({ type: "volatility_breach", threshold_pct: newVolThreshold }),
      key_level_break: () => ({ type: "key_level_break" }),
      price_threshold: () => ({
        type: "price_threshold",
        direction: newPriceDirection,
        price: newPriceLevel,
      }),
    };

    const rule: AlertRule = {
      id: generateRuleId(),
      name: newName || TRIGGER_LABELS[newTrigger],
      enabled: true,
      trigger: newTrigger,
      config: configMap[newTrigger](),
      channels,
    };

    setRules((prev) => [...prev, rule]);
    setAdding(false);
    setNewName("");
    setNewWebhookUrl("");
    setNewEmail("");
  }, [newTrigger, newName, newVolThreshold, newPriceLevel, newPriceDirection, newWebhookUrl, newEmail]);

  const toggleRule = useCallback((id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  }, []);

  const removeRule = useCallback((id: string) => {
    setRules((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveRules(next);
      return next;
    });
  }, []);

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">Alerts</h3>
          <p className="text-xs text-zinc-400">
            Get notified on signal changes, vol spikes, and price breaks
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          {expanded ? "Collapse" : `${rules.length} rule${rules.length !== 1 ? "s" : ""}`}
        </button>
      </div>

      {expanded && (
        <>
          {/* Active rules */}
          {rules.length > 0 && (
            <div className="space-y-2 mb-4">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 bg-zinc-700/30 border border-zinc-700 rounded-lg px-3 py-2 text-xs"
                >
                  <button
                    onClick={() => toggleRule(rule.id)}
                    className={`w-8 h-4 rounded-full transition-colors ${
                      rule.enabled ? "bg-green-500" : "bg-zinc-600"
                    }`}
                  >
                    <div
                      className={`w-3 h-3 bg-white rounded-full transition-transform ${
                        rule.enabled ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className="text-zinc-200 font-medium">{rule.name}</span>
                  <span className="text-zinc-500">
                    {TRIGGER_LABELS[rule.trigger]}
                  </span>
                  <span className="text-zinc-500">
                    {rule.channels.map((c) => c.type).join(", ") || "no channels"}
                  </span>
                  <button
                    onClick={() => removeRule(rule.id)}
                    className="ml-auto text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add rule form */}
          {adding ? (
            <div className="bg-zinc-700/30 border border-zinc-700 rounded-lg p-3 space-y-3 mb-4">
              <div className="flex gap-3 flex-wrap">
                <label className="text-xs text-zinc-400">
                  Name
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="My alert"
                    className="block mt-1 w-40 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  Trigger
                  <select
                    value={newTrigger}
                    onChange={(e) => setNewTrigger(e.target.value as AlertTrigger)}
                    className="block mt-1 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
                  >
                    {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </label>
                {newTrigger === "volatility_breach" && (
                  <label className="text-xs text-zinc-400">
                    Vol threshold (%)
                    <input
                      type="number"
                      value={newVolThreshold}
                      onChange={(e) => setNewVolThreshold(Number(e.target.value))}
                      className="block mt-1 w-20 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
                    />
                  </label>
                )}
                {newTrigger === "price_threshold" && (
                  <>
                    <label className="text-xs text-zinc-400">
                      Direction
                      <select
                        value={newPriceDirection}
                        onChange={(e) => setNewPriceDirection(e.target.value as "above" | "below")}
                        className="block mt-1 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
                      >
                        <option value="above">Above</option>
                        <option value="below">Below</option>
                      </select>
                    </label>
                    <label className="text-xs text-zinc-400">
                      Price ($/lb)
                      <input
                        type="number"
                        step={0.01}
                        value={newPriceLevel}
                        onChange={(e) => setNewPriceLevel(Number(e.target.value))}
                        className="block mt-1 w-24 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
                      />
                    </label>
                  </>
                )}
              </div>
              <div className="flex gap-3 flex-wrap">
                <label className="text-xs text-zinc-400">
                  Webhook URL (Slack, Discord, custom)
                  <input
                    value={newWebhookUrl}
                    onChange={(e) => setNewWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/..."
                    className="block mt-1 w-64 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  Email (optional)
                  <input
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="team@mill.com"
                    className="block mt-1 w-48 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={addRule}
                  className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded"
                >
                  Save Rule
                </button>
                <button
                  onClick={() => setAdding(false)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded mb-4"
            >
              + Add Alert Rule
            </button>
          )}

          {/* Fired alerts log */}
          {firedAlerts.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-400 uppercase mb-2">
                Recent Alerts
              </h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {firedAlerts.map((alert, i) => (
                  <div
                    key={`${alert.rule_id}-${i}`}
                    className="text-xs bg-zinc-700/30 rounded px-3 py-1.5 flex items-center gap-2"
                  >
                    <span className="text-zinc-500">
                      {new Date(alert.fired_at).toLocaleTimeString()}
                    </span>
                    <span className="text-zinc-200 font-medium">
                      {alert.rule_name}
                    </span>
                    <span className="text-zinc-400">{alert.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
