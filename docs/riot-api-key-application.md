# Riot Personal API Key Application Draft

## Product Information

- **Product Name:** Rift Record
- **Product URL:** https://rift-record.vercel.app/
- **Purpose:** Personal portfolio demo
- **Audience:** The developer and recruiters reviewing the portfolio
- **Usage:** Not intended for public consumption, commercial use, or large-scale community use

## Product Description

This is a personal portfolio project using the Riot Games API.

Rift Record allows limited users, such as myself and recruiters reviewing my portfolio, to search a
Riot ID and view recent League of Legends solo queue match history. It displays ranked information,
recent match cards, champion, KDA, items, game duration, champion mastery, recommended picks,
playstyle analysis, and a limited champion tier table calculated from match data collected by this
project.

This project is not intended for public consumption, commercial use, or large-scale community use.
It will be shared only as part of my personal portfolio.

All Riot API requests are handled through a backend server. The Riot API key is stored as an
environment variable and is not exposed on the client side. Match and participant data are stored
in Supabase to avoid duplicate Riot API requests and to support persistent champion tier
calculations in the deployed Vercel environment.

The champion tier list is not an official Riot Games ranking. It is calculated from limited
collected match data and displays low-sample warnings when data is insufficient.

This product clearly states that it is not endorsed by Riot Games and does not reflect the views or
opinions of Riot Games.

## Main Features

- Riot ID and Tagline search
- Ranked tier, LP, wins, and losses
- Latest 15 solo queue match analysis
- KDA, CS/min, kill participation, damage, vision, items, and duration
- Champion mastery and recommended picks
- Playstyle, champion, and position performance analysis
- Limited position-based custom champion tier table
- Shareable result URL and Demo Mode

## Riot APIs Used

- ACCOUNT-V1
- MATCH-V5
- LEAGUE-V4
- CHAMPION-MASTERY-V4
- Riot Data Dragon

## Backend And Security

The browser calls only Rift Record backend endpoints under `/api`. `RIOT_API_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are stored in Vercel Environment Variables and are never embedded in
client assets or returned by API responses. `.env`, `.env.local`, and local JSON data are excluded
from Git.

## Persistent Storage

Supabase stores match metadata, raw match JSON, normalized participant rows, and calculated champion
tier cache rows. Existing match IDs are read from the database before MATCH-V5 detail requests, which
reduces duplicate calls and supports persistent collection across Vercel serverless invocations.

## Rate Limit Considerations

- Server-side Riot request queue
- Limited retry for HTTP 429 using `Retry-After`
- Small collection batches
- Match ID deduplication and database reuse
- Short summoner response cache

## Champion Tier Method

The reference score combines normalized win rate, pick rate, average KDA, and sample confidence.
Grades are calculated separately per position. Champions with fewer than 10 collected games are
marked `Low Sample`.

## Demo Mode

Demo Mode uses local mock data and works without Riot API or Supabase configuration. Demo data is
never inserted into the production champion tier database.

## Riot Games Notice

This product is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties.
