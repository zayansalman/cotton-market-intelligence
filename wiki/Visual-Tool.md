# Visual Product (Current)

The visual product is now the **web app**, not a Python plotting script.

## Live URL

- [https://cmi-notebooks.vercel.app](https://cmi-notebooks.vercel.app)

## What users see

- Real-time cotton benchmark cards
- Price history chart with 50d/200d moving averages
- Buy/Hold/Avoid signal with confidence
- Executive summary + market analysis
- Month-by-month purchase roadmap (table + chart)
- Risks and next actions
- News headlines used for context
- JSON export of full strategy output

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API-backed UI

- `/api/prices`
- `/api/headlines`
- `/api/strategy`
