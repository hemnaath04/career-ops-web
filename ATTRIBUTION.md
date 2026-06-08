# Attribution

`career-ops-web` is a web GUI **on top of** [santifer/career-ops](https://github.com/santifer/career-ops).
None of the career-ops source is redistributed in this repository — we
clone it separately at runtime (see `deploy/setup.sh`) and read its
`modes/*.md` and `templates/portals.example.yml` files. All of the
evaluation logic, the A-F rubric, the curated company list, and the
prompts that drive the LLM live in santifer's repo.

## Original work

| Project | Author | License |
|---|---|---|
| **career-ops** | Santiago Fernández de Valderrama (`@santifer`, hi@santifer.io) | [MIT](https://github.com/santifer/career-ops/blob/main/LICENSE) |

Repo: https://github.com/santifer/career-ops
Portfolio: https://santifer.io

If career-ops's evaluations have helped your job hunt, the credit goes
to Santiago for the framework. This project is just a thin web wrapper.

## Trademark

The "career-ops" name and brand are governed by santifer's
[Trademark Policy](https://github.com/santifer/career-ops/blob/main/TRADEMARK.md):

> permissive for community use, reserved for commercial product naming
> and endorsement.

This project is a personal, non-commercial deployment by the maintainer.
It is not affiliated with, endorsed by, or a commercial product of
career-ops or its author. If you fork this for your own personal use,
you're operating under the same community-use understanding.

## License of this wrapper

The web-wrapper code in this repository (Express server, HTML/CSS/JS
frontend, deploy scripts) is released under MIT as well — see `LICENSE`.

## Other dependencies

- [Express](https://expressjs.com/) — MIT
- [OpenAI SDK](https://github.com/openai/openai-node) — Apache-2.0
- [multer](https://github.com/expressjs/multer) — MIT
- [pdf-parse](https://gitlab.com/autokent/pdf-parse) — MIT
- [js-yaml](https://github.com/nodeca/js-yaml) — MIT
- [dotenv](https://github.com/motdotla/dotenv) — BSD-2-Clause

## ATS endpoints

We hit publicly documented job-board endpoints provided by
[Greenhouse](https://developers.greenhouse.io/job-board.html),
[Lever](https://github.com/lever/postings-api), and
Ashby (their public hosted-board GraphQL). No reverse engineering, no
auth bypass — just the same URLs each ATS's hosted career page itself
uses.
