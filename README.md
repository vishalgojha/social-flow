# meta-cli

> A command-line tool for Meta's APIs. For devs tired of token gymnastics.

```text
 __  __      _          ____ _     ___
|  \/  | ___| |_ __ _  / ___| |   |_ _|
| |\/| |/ _ \ __/ _` | |   | |    | |
| |  | |  __/ || (_| | |___| |___ | |
|_|  |_|\___|\__\__,_|  \____|_____|___|
```

Tired of clicking through 47 dialogs to get a token? Fed up with decoding cryptic Graph API errors? Done with copy-pasting curl commands like it's 2010? This CLI is built to streamline the Meta API workflow.

## Features

- 🔐 **Token Management** - Store and manage access tokens for Facebook, Instagram, and WhatsApp
- 🚀 **Quick Queries** - Make API requests without writing full scripts
- ⚙️ **App Configuration** - Manage app credentials and settings
- 📊 **Rate Limit Checking** - Monitor your API usage and avoid hitting limits
- 🎨 **Beautiful Output** - Readable, colorized output (not just JSON dumps)
- 💡 **Helpful Errors** - Error messages that actually tell you what went wrong

## Installation

```bash
npm install -g @vishalgojha/meta-cli
```

Or run directly with npx:

```bash
npx @vishalgojha/meta-cli
```

## Quick Start

### 1. Authenticate

```bash
# Login with Facebook
meta auth login --api facebook

# Login with Instagram
meta auth login --api instagram

# Login with WhatsApp
meta auth login --api whatsapp

# Configure app credentials
meta auth app
```

### 2. Make Your First Query

```bash
# Get your profile info
meta query me

# Get your Facebook pages
meta query pages

# Get Instagram media
meta query instagram-media
```

### 3. Check Rate Limits

```bash
meta limits check
```

## Commands

### Authentication (`meta auth`)

Manage your access tokens and app credentials.

```bash
# Login with a token
meta auth login --api facebook --token YOUR_TOKEN

# Login interactively (prompts for token)
meta auth login

# Configure app credentials
meta auth app --id YOUR_APP_ID --secret YOUR_APP_SECRET

# Check authentication status
meta auth status

# Debug a token
meta auth debug

# Logout
meta auth logout --api facebook
meta auth logout --api all  # Remove all tokens
```

### Queries (`meta query`)

Query Meta APIs without writing scripts.

```bash
# Get your profile
meta query me
meta query me --fields id,name,email,picture

# Get Facebook pages
meta query pages

# Get Instagram media
meta query instagram-media --limit 20

# Custom API query
meta query custom /me/photos --fields id,name,created_time
meta query custom /PAGE_ID/posts --api facebook

# Output as JSON
meta query me --json
```

### App Management (`meta app`)

Manage app information and configuration.

```bash
# Get app info
meta app info

# Get info for specific app
meta app info --id YOUR_APP_ID

# List configured apps
meta app list

# Set default app
meta app set-default YOUR_APP_ID
```

### Rate Limits (`meta limits`)

Monitor and understand rate limits.

```bash
# Check current rate limit status
meta limits check

# Show rate limit documentation
meta limits docs
```

## Configuration

Configuration is stored at:
- macOS: `~/Library/Preferences/meta-cli-nodejs/`
- Linux: `~/.config/meta-cli-nodejs/`
- Windows: `%APPDATA%\meta-cli-nodejs\`

View your config:
```bash
meta auth status
```

## Getting Access Tokens

### Facebook/Instagram

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create an app or select existing app
3. Go to Tools > Graph API Explorer
4. Generate an access token
5. Copy the token and use: `meta auth login --token YOUR_TOKEN`

### WhatsApp Business

1. Go to [Meta Business Suite](https://business.facebook.com/)
2. Select your WhatsApp Business Account
3. Go to Settings > API Setup
4. Generate a permanent token
5. Copy the token and use: `meta auth login --api whatsapp --token YOUR_TOKEN`

## Examples

### Check your Facebook page stats

```bash
# Get your pages
meta query pages

# Get specific page info
meta query custom /PAGE_ID --fields name,fan_count,engagement
```

### Monitor Instagram engagement

```bash
# Get recent posts
meta query instagram-media --limit 10

# Get detailed media info
meta query custom /MEDIA_ID --fields like_count,comments_count,engagement
```

### Automated scripts

```bash
#!/bin/bash
# Check rate limits before running bulk operations
USAGE=$(meta limits check --json | jq -r '.usage.call_count')

if [ "$USAGE" -lt 75 ]; then
  echo "Safe to proceed (${USAGE}% usage)"
  # Run your bulk operations here
else
  echo "Rate limit high (${USAGE}%), waiting..."
  sleep 300
fi
```

## API Support

| API | Status | Commands Available |
|-----|--------|-------------------|
| Facebook Graph API | ✅ Full | auth, query, app, limits |
| Instagram Graph API | ✅ Full | auth, query, app, limits |
| WhatsApp Business API | 🚧 Partial | auth, query, limits |

## Troubleshooting

### "Token validation failed"
- Your token may be expired or invalid
- Generate a new token from Meta for Developers
- Make sure you're using the correct API (facebook/instagram/whatsapp)

### "Rate limit exceeded"
- You've made too many requests
- Check limits with: `meta limits check`
- Wait for the sliding window to reset (typically 1 hour)

### "No token found"
- You haven't authenticated yet
- Run: `meta auth login --api YOURAPI`

## Contributing

Found a bug? Have a feature request? Want to improve the Meta API developer workflow?

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a PR

## Philosophy

This tool is built on three principles:
1. **Transparency** - Be explicit about constraints, tradeoffs, and API behavior.
2. **Practicality** - Focus on what developers actually need, not what looks impressive.
3. **Respect** - Full credit to Meta for providing these APIs. Zero credit for the developer experience.

## License

MIT

## Disclaimer

This is an unofficial tool. Not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc.

---

**Built by Chaos Craft Labs.**

If this tool saved you from clicking through one more Facebook dialog, consider giving it a star ⭐
