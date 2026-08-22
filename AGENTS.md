# AGENTS.md

## Project overview
- This repository is a very small static web project.
- The main app entry point is `index.html`.
- There is no framework, bundler, TypeScript config, or package manager setup in this repo.
- Keep changes lightweight, portable, and easy to preview in a browser.

## Working conventions
- Prefer direct edits to `index.html` unless the task clearly requires more files.
- Keep markup semantic and accessible.
- Use small, self-contained CSS and JavaScript when needed; avoid introducing complex tooling or large dependencies.
- Preserve the project’s simple static-site nature.
- If you add assets or images, keep paths relative and simple.

## Validation
- This project is best validated by opening the page in a browser or serving the folder locally.
- A simple static preview is usually sufficient, for example: `python3 -m http.server 8000` from the project root.

## Default behavior for AI agents
- Make the smallest correct change for the request.
- Do not add frameworks, build steps, or unnecessary configuration files.
- Keep the implementation clean, readable, and suitable for a wedding landing page or similar static marketing page.
