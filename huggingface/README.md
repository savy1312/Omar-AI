---
title: Omar AI
emoji: 🎓
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: other
short_description: Tutor IA per istituti tecnici (versione web)
---

# Omar AI (versione web)

Questo Space fa girare la versione web di Omar AI da `Dockerfile` (porta 7860).
Le chiavi e i codici stanno in **Settings → Variables and secrets** dello Space, mai nel codice:

- `AI_API_KEY` (segreto, chiave Groq), `AI_PROVIDER=openai-compatible`,
  `AI_BASE_URL=https://api.groq.com/openai/v1`, `AI_MODEL=openai/gpt-oss-20b`
- `STUDENT_REGISTRATION_CODE`, `TEACHER_REGISTRATION_CODE` (segreti),
  `STUDENT_EMAIL_DOMAIN=itiomar.net`, `ALLOW_OPEN_REGISTRATION=false`

Guida completa: `docs/PUBBLICARE_ONLINE.md` § 6.
