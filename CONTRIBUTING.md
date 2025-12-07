# Contributing to Ollama Client

First off, thanks for taking the time to contribute! ❤️

All types of contributions are encouraged and valued. See the [Table of Contents](#table-of-contents) for different ways to help and details about how this project handles them.

## Table of Contents

- [I Have a Question](#i-have-a-question)
- [I Want To Contribute](#i-want-to-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Your First Code Contribution](#your-first-code-contribution)
- [Development Workflow](#development-workflow)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Development Server](#development-server)
  - [Code Quality (Linting & Formatting)](#code-quality-linting--formatting)
  - [Testing](#testing)

## I Have a Question

> If you want to ask a question, we assume that you have read the available [Documentation](https://github.com/Shishir435/ollama-client#readme).

Before you ask a question, it is best to search for existing [Issues](https://github.com/Shishir435/ollama-client/issues) that might help you. In case you have found a suitable issue and still need clarification, you can write your question in this issue. It is also advisable to search the internet for answers first.

## I Want To Contribute

### Reporting Bugs

- **Ensure the bug was not already reported** by searching on GitHub under [Issues](https://github.com/Shishir435/ollama-client/issues).
- If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/Shishir435/ollama-client/issues/new). Be sure to include a **title and clear description**, as many relevant information as possible, and a **code sample** or an **executable test case** demonstrating the expected behavior that is not occurring.

### Suggesting Enhancements

- Open a new issue and choose "Feature Request".
- Detailed descriptions are helpful: **What** do you want to achieve? **Why** do you need it? **How** do you imagine it working?

### Your First Code Contribution

Unsure where to begin contributing? You can start by looking through these `good-first-issue` and `help-wanted` issues:

- [Good First Issues](https://github.com/Shishir435/ollama-client/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)
- [Help Wanted](https://github.com/Shishir435/ollama-client/issues?q=is%3Aopen+is%3Aissue+label%3A%22help+wanted%22)

## Development Workflow

### Prerequisites

- **Node.js**: Version 20 or higher (LTS recommended).
- **pnpm**: This project uses `pnpm` for package management.

```bash
npm install -g pnpm
```

### Installation

1. Fork the repository.
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/ollama-client.git
   cd ollama-client
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```

### Development Server

This project is built with [Plasmo](https://docs.plasmo.com/). To start the development server with live reloading:

```bash
# For Chrome
pnpm dev

# For Firefox
pnpm dev:firefox
```

This will generate the extension in `build/chrome-mv3-dev` (or `build/firefox-mv2-dev`). You can load this unpacked extension into your browser.

### Code Quality (Linting & Formatting)

We use [Biome](https://biomejs.dev/) for fast linting and formatting.

- **Check for issues:**
  ```bash
  pnpm lint
  ```
- **Fix auto-fixable issues:**
  ```bash
  pnpm lint:fix
  ```
- **Format code:**
  ```bash
  pnpm format
  ```

Please ensuring all checks pass before submitting a PR.

### Testing

We use [Vitest](https://vitest.dev/) for unit and integration testing.

- **Run tests:**
  ```bash
  pnpm test
  ```
- **Run tests with UI:**
  ```bash
  pnpm test:ui
  ```
- **Check coverage:**
  ```bash
  pnpm test:coverage
  ```

---

## Attribution

This guide is based on the **contributing-gen**. [Make your own](https://github.com/bttger/contributing-gen)!
