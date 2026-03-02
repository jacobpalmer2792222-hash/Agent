import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const WEBHOOK_URL = "YOUR_N8N_WEBHOOK_URL_HERE";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// ─── SYSTEM PROMPT ─────────────────────────────────────────────────────────
const buildSystemPrompt = (userData) => `
You are Aria, Alony AI's elite onboarding specialist. You're helping ${userData.company_name || "this business"} set up their first AI voice agent. Your job is to collect all required configuration details through natural, exciting conversation — making the client feel like they're building something genuinely powerful.

## YOUR PERSONALITY
- Energetic, sharp, and genuinely excited about what this agent will do for their business
- You speak like a knowledgeable friend, not a form
- You celebrate their answers: "Perfect — that's going to make your agent incredibly effective"
- You explain jargon instantly without being condescending
- You ask ONE question at a time, never stack questions
- You make them feel like they're making important product decisions, not filling out a form

## PRE-LOADED CLIENT DATA (already known — do NOT ask for these)
- Company name: ${userData.company_name || "Unknown"}
- Email: ${userData.email || "Unknown"}
- Subscription plan: ${userData.plan || "Standard"}

## YOUR GOAL
Collect ALL of the following fields through conversation. Track internally what you have and what you still need.

### REQUIRED FIELDS TO COLLECT:

1. **agent_name** — What to name the agent (e.g. "Sarah from Acme Corp"). Suggest one based on context.
2. **inbound_outbound** — Is this agent making calls (outbound) or receiving them (inbound)?
3. **lead_data** — What data do they have on the people calling/being called? (name, number, email, job title, previous enquiry etc.)
4. **purpose** — What is the purpose of each call? What should the agent accomplish?
5. **warm_cold** — (Outbound ONLY) Are these warm leads (already know the company) or cold leads (first contact)?
6. **faq_objections** — Any specific FAQs or objections the agent should handle? (Optional — if they say none, leave blank)
7. **greeting_message** — The exact first thing the agent says. Suggest one based on context, easy to edit.
8. **tonality** — What tone? (e.g. professional, warm, energetic, empathetic, serious)
9. **desired_outcome** — What is a successful call? (book a meeting, qualify a lead, take a message, close a sale etc.)
10. **area_code** — What area code for the phone number? (US numbers)
11. **voicemail** — Should the agent leave a voicemail if no one answers? If yes, what should it say word for word?
12. **booking_capabilities** — Does the agent need to book appointments? (Explain: this means it can access a calendar and schedule in real time)
13. **call_transfer** — Should the agent be able to transfer calls to a human? If yes: what number, and under what conditions?

### FIELDS YOU ALREADY HAVE (never ask):
- company_name: ${userData.company_name}
- client_email: ${userData.email}
- subscription_plan: ${userData.plan}

## FORMATTING RULES — CRITICAL
- Use **bold** (double asterisks) ONLY for key terms or concepts inside your sentences — e.g. "What is the **purpose** of each call?" or "Are these **warm** or **cold** leads?"
- Never use single asterisks for anything — not for emphasis, not for bullet points, not in dialogue
- Never use markdown headers (#), dashes as bullets, or any other markdown syntax
- Bold should appear maybe once or twice per message on the most important word or concept — not everywhere
- Your messages should read as clean, natural sentences with selective bold for emphasis

## CONVERSATION FLOW

### Opening
Start with genuine excitement. Acknowledge who they are, what plan they're on, and what's about to happen. Example:
"Hey [company name]! 🚀 I'm Aria — I'll be helping you configure your AI voice agent today. This is genuinely one of the most exciting parts of being on Alony AI. We're going to build something that works for your business 24/7 from today. Let's start with the most important question — is this agent going to be making calls **outbound**, or answering **inbound** calls?"

### Explaining Confusing Concepts
When collecting these specific fields, always explain them naturally in plain conversational sentences:

For warm_cold: "Quick one — are these people who've heard of you before (**warm** leads), or is this their very first interaction with your brand (**cold** leads)? It changes how the agent opens the conversation."

For booking_capabilities: "Does your agent need to actually **book appointments** in real time during the call? This means it connects to your calendar and can lock in a time slot while the customer is on the phone. Super powerful if you need it."

For call_transfer: "Should the agent be able to hand the call off to a real human at any point? For example, if someone gets angry, or specifically asks to speak to a person — it can transfer them straight through. If yes, I'll need a **number** and the **conditions** for when to transfer."

### Suggestions
For agent_name: Based on the company name and inbound/outbound context, suggest a realistic agent name. e.g. "I'd suggest calling her **Sarah from [Company]** — keeps it natural and professional. Happy with that, or want something different?"

For greeting_message: Craft a realistic, natural-sounding greeting based on everything they've told you. Present it clearly and say "You can tweak this however you like."

For tonality: If they're unsure, suggest based on their industry and purpose.

### When You Have Everything
When all required fields are collected, output a special JSON signal ONLY — no extra text before or after:

ARIA_COMPLETE:{"agent_name":"...","inbound_outbound":"...","lead_data":"...","purpose":"...","warm_cold":"...","faq_objections":"...","greeting_message":"...","tonality":"...","desired_outcome":"...","area_code":"...","voicemail":"...","booking_capabilities":"...","call_transfer_allowed":"...","call_transfer_number":"...","call_transfer_requirements":"...","company_name":"${userData.company_name}","client_email":"${userData.email}","subscription_plan":"${userData.plan}","agent_name_display":"...","agent_description":"..."}

The agent_description should be a 1-sentence summary of what this agent does.

## CRITICAL RULES
- NEVER ask for company_name, client_email, or subscription_plan — you already have them
- Ask ONE question at a time
- Never use the word "field" or "form" — this is a conversation
- If they ask a question, answer it fully before continuing
- If they're unsure, help them decide — give them options or a recommendation
- Keep energy high throughout — every answer brings them closer to something powerful
- warm_cold is ONLY needed if inbound_outbound is outbound
- If call_transfer is yes, collect both the number AND the conditions
- Voicemail is only relevant for outbound — skip for inbound
`;

// ─── STORAGE HELPERS ───────────────────────────────────────────────────────
const STORAGE_KEY = "alony_onboarding_chat";

const saveChat = (messages, collectedData, userData) => {
  try {
    window.storage?.set(STORAGE_KEY, JSON.stringify({ messages, collectedData, userData, savedAt: Date.now() }));
  } catch {}
};

const loadChat = async () => {
  try {
    const result = await window.storage?.get(STORAGE_KEY);
    if (result?.value) return JSON.parse(result.value);
  } catch {}
  return null;
};

const clearChat = async () => {
  try {
    await window.storage?.delete(STORAGE_KEY);
  } catch {}
};

// ─── MARKDOWN RENDERER ─────────────────────────────────────────────────────
// Renders **bold** and *italic* inline, splits on newlines for paragraphs
const renderMarkdown = (text) => {
  if (!text) return null;

  const parseInline = (str, keyPrefix) => {
    const parts = [];
    // Match **bold** or *italic* — bold first to avoid greedy *italic* eating **
    const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
    let last = 0;
    let match;
    let idx = 0;
    while ((match = regex.exec(str)) !== null) {
      if (match.index > last) {
        parts.push(<span key={`${keyPrefix}-t${idx}`}>{str.slice(last, match.index)}</span>);
        idx++;
      }
      if (match[1] !== undefined) {
        parts.push(<strong key={`${keyPrefix}-b${idx}`} style={{ fontWeight: 700, color: "#e8d5ff" }}>{match[1]}</strong>);
      } else if (match[2] !== undefined) {
        parts.push(<em key={`${keyPrefix}-i${idx}`} style={{ fontStyle: "italic", color: "#c4b5fd" }}>{match[2]}</em>);
      }
      last = regex.lastIndex;
      idx++;
    }
    if (last < str.length) parts.push(<span key={`${keyPrefix}-t${idx}`}>{str.slice(last)}</span>);
    return parts;
  };

  return text.split("\n").map((line, i) => {
    if (line.trim() === "") return <div key={i} style={{ height: 6 }} />;
    return <div key={i} style={{ marginBottom: 2 }}>{parseInline(line, `line${i}`)}</div>;
  });
};

// ─── TYPING INDICATOR ──────────────────────────────────────────────────────
const TypingIndicator = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "14px 18px", background: "rgba(255,255,255,0.06)", borderRadius: 16, borderBottomLeftRadius: 4, width: "fit-content", maxWidth: 80 }}>
    {[0, 1, 2].map(i => (
      <div key={i} style={{
        width: 7, height: 7, borderRadius: "50%", background: "#a78bfa",
        animation: "bounce 1.2s infinite", animationDelay: `${i * 0.2}s`
      }} />
    ))}
  </div>
);

// ─── MESSAGE BUBBLE ────────────────────────────────────────────────────────
const MessageBubble = ({ msg, isNew }) => {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex", justifyContent: isUser ? "flex-end" : "flex-start",
      animation: isNew ? "fadeSlideIn 0.35s ease forwards" : "none",
      opacity: isNew ? 0 : 1
    }}>
      {!isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4318c4,#6b3ef0)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0,
          marginRight: 10, marginTop: 2, fontFamily: "'Nunito', sans-serif",
          boxShadow: "0 0 0 2px rgba(107,62,240,0.3)"
        }}>A</div>
      )}
      <div style={{
        maxWidth: "72%", padding: "13px 17px",
        background: isUser
          ? "linear-gradient(135deg,#4318c4,#6b3ef0)"
          : "rgba(255,255,255,0.07)",
        borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        color: "#fff", fontSize: 14.5, lineHeight: 1.65,
        fontFamily: "'DM Sans', sans-serif",
        boxShadow: isUser ? "0 4px 20px rgba(67,24,196,0.4)" : "0 2px 12px rgba(0,0,0,0.2)",
        border: isUser ? "none" : "1px solid rgba(255,255,255,0.08)",
        wordBreak: "break-word"
      }}>
        {isUser ? msg.content : renderMarkdown(msg.content)}
      </div>
    </div>
  );
};

// ─── SUMMARY CARD ──────────────────────────────────────────────────────────
const SummaryCard = ({ data, onEdit, onSubmit, submitting, submitted, warning }) => {
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState("");

  const fields = [
    { key: "agent_name", label: "Agent Name" },
    { key: "inbound_outbound", label: "Direction" },
    { key: "purpose", label: "Purpose" },
    { key: "desired_outcome", label: "Desired Outcome" },
    { key: "tonality", label: "Tone" },
    { key: "greeting_message", label: "Greeting Message" },
    { key: "lead_data", label: "Lead Data" },
    { key: "warm_cold", label: "Lead Temperature" },
    { key: "area_code", label: "Area Code" },
    { key: "booking_capabilities", label: "Booking Capabilities" },
    { key: "call_transfer_allowed", label: "Call Transfer" },
    { key: "call_transfer_number", label: "Transfer Number" },
    { key: "call_transfer_requirements", label: "Transfer Conditions" },
    { key: "voicemail", label: "Voicemail" },
    { key: "faq_objections", label: "FAQ & Objections" },
  ].filter(f => data[f.key] && data[f.key] !== "N/A" && data[f.key] !== "none" && data[f.key] !== "No" && data[f.key] !== "false");

  const startEdit = (key, val) => { setEditingKey(key); setEditValue(val); };
  const saveEdit = () => { onEdit(editingKey, editValue); setEditingKey(null); };

  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 20, overflow: "hidden", marginTop: 8
    }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#4318c4,#6b3ef0)", padding: "20px 24px" }}>
        <div style={{ fontFamily: "'Nunito', sans-serif", fontSize: 18, fontWeight: 800, color: "#fff" }}>
          🚀 Your Agent Configuration
        </div>
        <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 4 }}>
          Review everything below — click any field to edit before we build
        </div>
      </div>

      {/* Fields */}
      <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 2 }}>
        {fields.map(({ key, label }) => (
          <div key={key} style={{
            display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0",
            borderBottom: "1px solid rgba(255,255,255,0.05)"
          }}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.45)", width: 140, flexShrink: 0, paddingTop: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
            {editingKey === key ? (
              <div style={{ flex: 1, display: "flex", gap: 8 }}>
                <textarea
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  style={{
                    flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(107,62,240,0.6)",
                    borderRadius: 8, color: "#fff", padding: "8px 10px", fontSize: 13,
                    fontFamily: "'DM Sans', sans-serif", resize: "vertical", minHeight: 60, outline: "none"
                  }}
                  autoFocus
                />
                <button onClick={saveEdit} style={{
                  background: "linear-gradient(135deg,#4318c4,#6b3ef0)", border: "none",
                  borderRadius: 8, color: "#fff", padding: "0 14px", cursor: "pointer",
                  fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: 12
                }}>Save</button>
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, color: "#e8e0ff", lineHeight: 1.5 }}>{data[key]}</div>
                <button onClick={() => startEdit(key, data[key])} style={{
                  background: "rgba(107,62,240,0.15)", border: "1px solid rgba(107,62,240,0.3)",
                  borderRadius: 6, color: "#a78bfa", padding: "3px 10px", cursor: "pointer",
                  fontSize: 11, fontFamily: "'DM Sans', sans-serif", flexShrink: 0
                }}>Edit</button>
              </div>
            )}
          </div>
        ))}

        {/* Pre-loaded fields */}
        <div style={{ marginTop: 8, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "'DM Sans', sans-serif", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>Pre-loaded from your account</div>
          {[
            { label: "Company", val: data.company_name },
            { label: "Email", val: data.client_email },
            { label: "Plan", val: data.subscription_plan },
          ].map(({ label, val }) => val && (
            <div key={label} style={{ display: "flex", gap: 12, padding: "4px 0" }}>
              <div style={{ width: 140, fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "'DM Sans', sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", fontFamily: "'DM Sans', sans-serif" }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Warning */}
      {warning && (
        <div style={{ margin: "0 24px 12px", padding: "10px 14px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 10 }}>
          <div style={{ fontSize: 12.5, color: "#fbbf24", fontFamily: "'DM Sans', sans-serif" }}>⚠️ {warning}</div>
        </div>
      )}

      {/* Submit button */}
      <div style={{ padding: "0 24px 24px" }}>
        <button
          onClick={onSubmit}
          disabled={submitting || submitted}
          style={{
            width: "100%", padding: "16px", borderRadius: 12, border: "none",
            background: submitted ? "rgba(52,211,153,0.2)" : "linear-gradient(135deg,#4318c4,#6b3ef0)",
            color: "#fff", fontFamily: "'Nunito', sans-serif", fontWeight: 800,
            fontSize: 15, cursor: submitting || submitted ? "not-allowed" : "pointer",
            opacity: submitting ? 0.7 : 1,
            boxShadow: submitted ? "none" : "0 8px 32px rgba(67,24,196,0.5)",
            transition: "all 0.3s ease", letterSpacing: "0.2px"
          }}
        >
          {submitted ? "✅ Agent Created — Check Your Dashboard" : submitting ? "Building your agent..." : "🚀 Create My Agent"}
        </button>
      </div>
    </div>
  );
};

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────
export default function AlonyOnboarding() {
  // Simulate inbound user data (in production this comes from your webhook/session)
  const [userData] = useState({
    company_name: "Acme Corp",
    email: "hello@acmecorp.com",
    plan: "Standard"
  });

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [collectedData, setCollectedData] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [warning, setWarning] = useState(null);
  const [newMessageIndex, setNewMessageIndex] = useState(-1);
  const [restored, setRestored] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const conversationHistory = useRef([]);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => { scrollToBottom(); }, [messages, loading]);

  // ── Load saved chat or start fresh
  useEffect(() => {
    (async () => {
      const saved = await loadChat();
      if (saved && saved.messages?.length > 0) {
        setMessages(saved.messages);
        conversationHistory.current = saved.messages.map(m => ({ role: m.role, content: m.content }));
        if (saved.collectedData) setCollectedData(saved.collectedData);
        setRestored(true);
      } else {
        startConversation();
      }
      setInitialized(true);
    })();
  }, []);

  useEffect(() => {
    if (restored && initialized) {
      // Show restored banner briefly
    }
  }, [restored, initialized]);

  const startConversation = async () => {
    setLoading(true);
    try {
      const systemPrompt = buildSystemPrompt(userData);
      const initMessage = { role: "user", content: `START_ONBOARDING` };
      conversationHistory.current = [initMessage];

      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: conversationHistory.current
        })
      });

      const data = await res.json();
      const reply = data.content?.[0]?.text || "";

      const assistantMsg = { role: "assistant", content: reply, id: Date.now() };
      conversationHistory.current.push({ role: "assistant", content: reply });
      setMessages([assistantMsg]);
      setNewMessageIndex(0);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    setInput("");

    const userMsg = { role: "user", content: text, id: Date.now() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setNewMessageIndex(updatedMessages.length - 1);
    conversationHistory.current.push({ role: "user", content: text });

    setLoading(true);
    try {
      const systemPrompt = buildSystemPrompt(userData);
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: conversationHistory.current
        })
      });

      const data = await res.json();
      const reply = data.content?.[0]?.text || "";

      // Check for completion signal
      if (reply.includes("ARIA_COMPLETE:")) {
        const jsonStr = reply.split("ARIA_COMPLETE:")[1].trim();
        try {
          const parsed = JSON.parse(jsonStr);
          setCollectedData(parsed);
          conversationHistory.current.push({ role: "assistant", content: reply });

          const confirmMsg = {
            role: "assistant",
            content: `That's everything I need! 🎉 Here's a full summary of your agent configuration — review it carefully, make any edits, and when you're happy hit the button to go live.`,
            id: Date.now() + 1
          };
          const finalMessages = [...updatedMessages, confirmMsg];
          setMessages(finalMessages);
          setNewMessageIndex(finalMessages.length - 1);
          saveChat(finalMessages, parsed, userData);
        } catch (e) {
          console.error("Failed to parse collected data", e);
        }
      } else {
        const assistantMsg = { role: "assistant", content: reply, id: Date.now() };
        conversationHistory.current.push({ role: "assistant", content: reply });
        const finalMessages = [...updatedMessages, assistantMsg];
        setMessages(finalMessages);
        setNewMessageIndex(finalMessages.length - 1);
        saveChat(finalMessages, collectedData, userData);
      }
    } catch (e) {
      console.error(e);
      const errMsg = { role: "assistant", content: "Something went wrong — please try again.", id: Date.now() };
      setMessages(prev => [...prev, errMsg]);
    }
    setLoading(false);
    inputRef.current?.focus();
  }, [messages, loading, userData, collectedData]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleEdit = (key, value) => {
    setCollectedData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setWarning(null);

    const requiredFields = ["agent_name", "inbound_outbound", "purpose", "desired_outcome", "tonality", "greeting_message", "area_code"];
    const missing = requiredFields.filter(f => !collectedData[f]);
    if (missing.length > 0) {
      setWarning(`Some fields are missing: ${missing.join(", ")}. You can still submit but your agent may need manual configuration.`);
    }

    // Map to n8n webhook payload
    const payload = {
      "The agents name": collectedData.agent_name,
      "Inbound/Outbound": collectedData.inbound_outbound,
      "Data you have on people you are calling/called by": collectedData.lead_data,
      "Your website": "",
      "Your company name": collectedData.company_name,
      "The purpose of the call for outbound/ reason for inquiry inbound": collectedData.purpose,
      "Warm or cold lead (Outbound ONLY)": collectedData.warm_cold || "",
      "FAQ and Objection Handling (Leave blank for general responses)": collectedData.faq_objections || "",
      "Agent Greeting Message": collectedData.greeting_message,
      "Tonality of agent e.g. Serious, Happy, Empathetic": collectedData.tonality,
      "Desired Outcome of Call": collectedData.desired_outcome,
      "Area code": collectedData.area_code,
      "Leave a voicemail (If no leave blank, if yes write word for word, including variable)": collectedData.voicemail || "",
      "Will the agent need booking capabilities": collectedData.booking_capabilities,
      "Call transfer allowed (If yes answer below)": collectedData.call_transfer_allowed === "Yes" ? ["Yes"] : ["No"],
      "Call transfer number": collectedData.call_transfer_number || "",
      "Call transfer requirements (Copy and paste if provided by user write or write exactly 'Normal' for normal rules)": collectedData.call_transfer_requirements || "",
      "Subscription Plan": collectedData.subscription_plan,
      "Company Name": collectedData.company_name,
      "Client Phone Number": "",
      "Client Email": collectedData.client_email,
      "External CRM/Software": "No",
      "External Endpoint": "",
      "Agent Name": collectedData.agent_name,
      "Agent Description": collectedData.agent_description || collectedData.purpose
    };

    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "no-cors"
      });
      setSubmitted(true);
      await clearChat();
    } catch (e) {
      console.error(e);
      setSubmitted(true); // still mark done since no-cors can't read response
      await clearChat();
    }
    setSubmitting(false);
  };

  const handleRestart = async () => {
    await clearChat();
    setMessages([]);
    setCollectedData(null);
    setSubmitted(false);
    setWarning(null);
    conversationHistory.current = [];
    startConversation();
  };

  if (!initialized) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0d0b1a" }}>
        <div style={{ color: "#a78bfa", fontFamily: "'Nunito', sans-serif", fontSize: 16 }}>Loading...</div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@300;400;500;600&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(107,62,240,0.3); border-radius: 2px; }

        textarea:focus { outline: none !important; }
        button:hover { filter: brightness(1.1); }
      `}</style>

      <div style={{
        width: "100%", height: "100vh", background: "#0d0b1a",
        display: "flex", flexDirection: "column", overflow: "hidden",
        fontFamily: "'DM Sans', sans-serif", position: "relative"
      }}>
        {/* Background glow */}
        <div style={{
          position: "absolute", top: -200, left: "50%", transform: "translateX(-50%)",
          width: 600, height: 600, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(107,62,240,0.15) 0%, transparent 70%)",
          pointerEvents: "none", zIndex: 0
        }} />

        {/* Header */}
        <div style={{
          background: "rgba(13,11,26,0.95)", backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "16px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "relative", zIndex: 10, flexShrink: 0
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: "linear-gradient(135deg,#4318c4,#6b3ef0)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Nunito', sans-serif", fontSize: 16, fontWeight: 900, color: "#fff",
              boxShadow: "0 0 20px rgba(107,62,240,0.4)"
            }}>A</div>
            <div>
              <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 800, fontSize: 15, color: "#fff" }}>Aria</div>
              <div style={{ fontSize: 11.5, color: "#a78bfa", display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", animation: "pulse 2s infinite" }} />
                Alony AI Onboarding Specialist
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* User pill */}
            <div style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 100, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8
            }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#6b3ef0" }} />
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{userData.company_name}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", background: "rgba(107,62,240,0.2)", padding: "2px 7px", borderRadius: 100 }}>{userData.plan}</span>
            </div>

            {messages.length > 1 && (
              <button onClick={handleRestart} style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8, color: "rgba(255,255,255,0.4)", padding: "7px 12px",
                cursor: "pointer", fontSize: 11.5, fontFamily: "'DM Sans', sans-serif"
              }}>Start over</button>
            )}
          </div>
        </div>

        {/* Restored banner */}
        {restored && !collectedData && (
          <div style={{
            background: "rgba(107,62,240,0.15)", borderBottom: "1px solid rgba(107,62,240,0.2)",
            padding: "10px 24px", display: "flex", alignItems: "center", gap: 8,
            flexShrink: 0
          }}>
            <span style={{ fontSize: 12.5, color: "#a78bfa", fontFamily: "'DM Sans', sans-serif" }}>
              💾 We saved your progress — picking up where you left off
            </span>
          </div>
        )}

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "24px 24px 0 24px",
          display: "flex", flexDirection: "column", gap: 16, position: "relative", zIndex: 1
        }}>
          {messages.map((msg, i) => (
            <MessageBubble key={msg.id || i} msg={msg} isNew={i === newMessageIndex} />
          ))}

          {loading && (
            <div style={{ animation: "fadeSlideIn 0.3s ease forwards" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#4318c4,#6b3ef0)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0,
                  fontFamily: "'Nunito', sans-serif", boxShadow: "0 0 0 2px rgba(107,62,240,0.3)"
                }}>A</div>
                <TypingIndicator />
              </div>
            </div>
          )}

          {/* Summary card */}
          {collectedData && !loading && (
            <div style={{ animation: "fadeSlideIn 0.4s ease forwards" }}>
              <SummaryCard
                data={collectedData}
                onEdit={handleEdit}
                onSubmit={handleSubmit}
                submitting={submitting}
                submitted={submitted}
                warning={warning}
              />
            </div>
          )}

          <div ref={messagesEndRef} style={{ height: 24 }} />
        </div>

        {/* Input area */}
        {!collectedData && (
          <div style={{
            padding: "16px 24px 24px", background: "rgba(13,11,26,0.95)",
            backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.06)",
            position: "relative", zIndex: 10, flexShrink: 0
          }}>
            <div style={{
              display: "flex", gap: 12, alignItems: "flex-end",
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 16, padding: "12px 14px",
              transition: "border-color 0.2s ease",
              boxShadow: "0 4px 24px rgba(0,0,0,0.3)"
            }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer..."
                disabled={loading}
                rows={1}
                style={{
                  flex: 1, background: "transparent", border: "none", color: "#fff",
                  fontSize: 14.5, fontFamily: "'DM Sans', sans-serif", resize: "none",
                  lineHeight: 1.6, maxHeight: 120, overflow: "auto", outline: "none",
                  opacity: loading ? 0.5 : 1
                }}
                onInput={e => {
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                style={{
                  width: 38, height: 38, borderRadius: 10, border: "none",
                  background: input.trim() && !loading ? "linear-gradient(135deg,#4318c4,#6b3ef0)" : "rgba(255,255,255,0.08)",
                  color: "#fff", cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, transition: "all 0.2s ease",
                  boxShadow: input.trim() && !loading ? "0 4px 16px rgba(67,24,196,0.5)" : "none"
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.2)", fontFamily: "'DM Sans', sans-serif" }}>
              Press Enter to send · Shift+Enter for new line
            </div>
          </div>
        )}
      </div>
    </>
  );
}
