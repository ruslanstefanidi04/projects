# TIMEGUARD

Time patrol: day/week schedule, notes, customizable Pomodoro. RU/EN, light/dark.

## Stack

- Next.js 14 + Tailwind + Framer Motion
- Prisma + PostgreSQL (Neon free or local Docker)
- NextAuth credentials
- Vercel

## Local

```bash
# 1) DB
docker compose up -d

# 2) env
copy .env.example .env
# set DATABASE_URL to local docker line from .env.example
# set NEXTAUTH_SECRET to any long random string

# 3) install + schema
npm i
npx prisma generate
npx prisma db push

# 4) run
npm run dev
```

http://localhost:3000

## Neon (free prod DB)

1. Create project at https://neon.tech
2. Copy connection string into Vercel env `DATABASE_URL`
3. `npx prisma db push` against that URL (or run once from CI/local with prod URL)

## Vercel

```bash
npm run deploy:vercel
```

Env on Vercel:

- `DATABASE_URL` - Neon
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` - your deployment URL
- `NEXT_PUBLIC_SITE_URL` - same (keep `*.vercel.app` noindex until brand domain)

## Features

- Day board with timed blocks
- Week grid
- Notes with pin
- Pomodoro focus/break/long, lengths in settings
- Theme light/dark, accent, density, locale RU/EN
