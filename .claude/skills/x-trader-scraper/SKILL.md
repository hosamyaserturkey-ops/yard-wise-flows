---
name: x-trader-scraper
description: Use when the user wants to find X (Twitter) users or communities interested in prop firms, funded trading, crypto trading, forex signals, or similar topics, and export them to an Excel spreadsheet with profile links, follower counts, and bio details. Searches via the Apify tweet-scraper API and deduplicates authors.
---

# X Trader Scraper

Finds X (Twitter) users by topic keywords and writes them to an `.xlsx` file
with handle, profile URL, follower count, verified status, and bio.

The skill uses the Apify `apidojo/tweet-scraper` actor to search recent tweets
matching the keywords, then deduplicates the tweet authors. Bigger / more
active accounts surface first.

## Prerequisites

1. Apify account — sign up free at <https://apify.com> (the $5 starter credit
   covers ~16k tweet scrapes; no card required to begin).
2. Set the API token in the environment **before** invoking the skill:

   ```bash
   export APIFY_TOKEN="apify_api_xxxxxxxxxxxxxxxx"
   ```

   The token lives in Apify Console → Settings → Integrations.
3. Install Python deps once:

   ```bash
   pip install -r .claude/skills/x-trader-scraper/requirements.txt
   ```

## How to run

Defaults are tuned for prop-firm / crypto-trading discovery:

```bash
python3 .claude/skills/x-trader-scraper/scrape.py
```

Customize keywords, sample size, and output path:

```bash
python3 .claude/skills/x-trader-scraper/scrape.py \
  --keywords "prop firm,funded trader,FTMO,crypto signals,altcoin" \
  --max-tweets 500 \
  --output traders.xlsx
```

## Default keywords

`prop firm`, `funded trader`, `crypto trader`, `FTMO`, `MyForexFunds`,
`crypto signals`, `forex signals`, `funded account`

## Output

An `.xlsx` file with one row per unique user, sorted by follower count
(descending). Columns:

| Column | Description |
| --- | --- |
| Handle | `@username` |
| Display Name | Profile display name |
| Profile URL | Clickable link to `https://x.com/<handle>` |
| Followers | Follower count |
| Following | Following count |
| Verified | `Yes` / `No` (blue check) |
| Bio | Profile description (single-line) |
| Matched Keyword | Which search term surfaced the account |

## Cost & limits

- Apify `apidojo/tweet-scraper` pricing: ~$0.30 per 1,000 tweets.
- 500 tweets typically yields 150–300 unique users depending on overlap.
- Free $5 credit ≈ 16,000 tweets ≈ several thousand unique traders.

## Tips

- Combine narrow keywords (`FTMO`, `The5ers`) with broad ones (`prop firm`)
  to balance precision and recall.
- Re-run with different `--output` paths to build topic-specific sheets
  (e.g. `crypto.xlsx` vs. `forex.xlsx`).
- The `--max-tweets` flag is the cost dial — start low (100–200) to validate
  keyword quality before scaling up.
