# ⚡ Prompt Compressor MCP

A high-performance **Model Context Protocol (MCP)** server designed to compress verbose prompts into dense, technical instructions. Save up to 501%+ tokens while preserving 100% of your technical intent and constraints.

---

## 🚀 Why Prompt Compressor?

As AI context windows grow, so do the costs and latencies. Large prompts slow down models and eat through your token budget. **Prompt Compressor** uses a "racing" strategy across multiple ultra-fast models (Groq, Cerebras, Gemini) to rewrite your prompts in a telegraphic, developer-optimized style instantly.

### Key Features
- **🏎️ Parallel Racing**: Hits multiple providers simultaneously and returns the first successful result.
- **🛡️ Multi-Tier Fallbacks**: Automatically falls back to secondary providers or optimized regex rules if the "fast tier" fails.
- **📉 Token Optimization**: Typically saves 30-60% of original token count.
- **🧠 Hardened System Prompt**: Heavily tuned to prevent "predictive engineering"—it only preserves what you actually wrote.

---

## 📦 Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- At least one API Key (Groq, Cerebras, or Google Gemini)

### 1. Configure Environment
Clone the repo and create your `.env` file:
```bash
git clone https://github.com/your-username/prompt-compressor.git
cd prompt-compressor
cp .env.example .env
```
Edit `.env` and add your API keys.

### 2. Add to your MCP Client

#### **Claude Desktop**
Add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "prompt-compressor": {
      "command": "node",
      "args": ["/path/to/prompt-compressor/index.js"],
      "env": {
        "GROQ_API_KEY": "your_key_here",
        "GOOGLE_API_KEY": "your_key_here"
      }
    }
  }
}
```

#### **Cursor / Windsurf**
1. Open Settings -> MCP.
2. Add a new server.
3. Type: `command`
4. Name: `prompt-compressor`
5. Command: `node /absolute/path/to/prompt-compressor/index.js`

---

## 🛠️ Supported Providers

| Provider | Tier | Model | Speed |
| :--- | :--- | :--- | :--- |
| **Cerebras** | Fast | Llama 3.3 70B | Ultra Fast |
| **Groq** | Fast | Llama 3.1 8B | Ultra Fast |
| **Google** | Fast | Gemini 3.0 Flash | Fast |
| **OpenRouter** | Fallback | Llama 3.1 8B Free | Variable |
| **HuggingFace** | Fallback | Llama 3.1 8B | Variable |

---

## 📖 Example

**Original Prompt (299 tokens):**
> "I am currently working on a complex enterprise-grade web application and I would really appreciate it if you could help me architect and implement a very robust and scalable authentication system. I am planning on using Next.js for the frontend part of things and I want to connect it to a PostgreSQL database using an ORM like Drizzle or maybe Prisma, whichever you think is better for performance. For the actual authentication logic, I want to use JWT tokens because they are standard and secure. Please make sure that you include full error handling for all potential edge cases, like when the database is down or when a user provides an invalid password. Also, it is extremely important to me that the code remains very clean, highly readable, and adheres to all the latest industry best practices for security and performance. I also need you to consider things like rate limiting so that malicious actors cannot spam our login endpoint and potentially cause a denial of service attack. Could you also provide a detailed explanation of how the whole system connects together so that I can explain it to my team later during our engineering sync? Thank you so much for your help with this!"

**Compressed Prompt (54 tokens):**
> "Task: Enterprise-grade auth system. Next.js frontend. PostgreSQL db @ Drizzle/Prisma. auth @ JWT. Constraint: perf, clean, secure, rate limit. Error handling: db down, invalid password. Explain system architecture."

**Result:** **~82% Token Savings (Saved 245 tokens)**

---

## 📜 License
MIT © [Ezzio](https://github.com/Ezzio11) & [Samahy](https://github.com/MO-Elsamahy)