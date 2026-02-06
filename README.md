# wow-api-mcp

MCP server for World of Warcraft API data. Parses the [ketho.wow-api](https://marketplace.visualstudio.com/items?itemName=ketho.wow-api) VS Code extension's annotations and exposes structured WoW API data through queryable tools — including deprecated functions, replacements, parameter types, return types, game version compatibility, enums, events, and widget methods.

Built to give AI agents (Claude Code, Claude Desktop, etc.) accurate, structured WoW API data without relying on wiki template parsing.

## Data

Indexes the full WoW API from the extension's LuaLS annotations:

- **8,000+ functions** with full signatures, parameters, return types, and wiki links
- **90+ deprecated functions** with replacement function, replacement URL, and deprecation patch version
- **260 C_ namespaces** (C_SpellBook, C_Item, C_Spell, etc.)
- **860+ widget types** with methods (Frame, Button, ScriptRegion, etc.)
- **843 enums** with values (Enum.SpellBookSpellBank, etc.)
- **1,716 events** with payload parameters (ADDON_LOADED, PLAYER_LOGIN, etc.)
- **1,591 CVars**
- **Game version compatibility** per function (Mainline, Vanilla, Mists)

## Tools

| Tool | Description |
|---|---|
| `lookup_api(name)` | Look up a function by exact or partial name |
| `search_api(query)` | Full-text search across API names and descriptions |
| `list_deprecated(filter?)` | List deprecated functions with replacements |
| `get_namespace(name)` | Get all functions in a C_ namespace (or `"list"` for all) |
| `get_widget_methods(widget_type)` | Get widget class methods (or `"list"` for all) |
| `get_enum(name)` | Look up enum values |
| `get_event(name)` | Look up event payload parameters |

## Prerequisites

### 1. Node.js

Node.js 18+ is required.

### 2. ketho.wow-api VS Code Extension

The MCP server reads data from this extension's annotation files. Install it in VS Code:

```bash
code --install-extension ketho.wow-api
```

Or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ketho.wow-api).

The server auto-discovers the extension from these locations:
- `~/.vscode/extensions/` (VS Code)
- `~/.vscode-insiders/extensions/` (VS Code Insiders)
- `~/.vscode-oss/extensions/` (VS Code OSS / VSCodium)
- `~/.cursor/extensions/` (Cursor)

If your extension is installed elsewhere, set the `WOW_API_EXT_PATH` environment variable to the extension root directory (the folder containing the `Annotations/` directory).

### 3. Install Dependencies

```bash
cd wow-api-mcp
npm install
```

## Setup

### Claude Code

Add to your project's `.mcp.json` (or `~/.claude.json` for global access):

```json
{
  "mcpServers": {
    "wow-api": {
      "command": "node",
      "args": ["/path/to/wow-api-mcp/src/index.mjs"]
    }
  }
}
```

Then restart Claude Code to pick up the new server.

To auto-allow all tools without permission prompts, add to your Claude Code settings:

```json
{
  "permissions": {
    "allow": ["mcp__wow-api__*"]
  }
}
```

### Claude Desktop

Add to your Claude Desktop config file:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wow-api": {
      "command": "node",
      "args": ["C:\\path\\to\\wow-api-mcp\\src\\index.mjs"]
    }
  }
}
```

If the extension is not in a standard VS Code location, add the env var:

```json
{
  "mcpServers": {
    "wow-api": {
      "command": "node",
      "args": ["C:\\path\\to\\wow-api-mcp\\src\\index.mjs"],
      "env": {
        "WOW_API_EXT_PATH": "C:\\path\\to\\ketho.wow-api-0.22.1"
      }
    }
  }
}
```

### VS Code (Copilot / Other MCP Clients)

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "wow-api": {
      "command": "node",
      "args": ["${workspaceFolder}/wow-api-mcp/src/index.mjs"]
    }
  }
}
```

## Usage Examples

Once connected, your AI agent can query the WoW API:

```
> lookup_api("IsSpellKnown")

[DEPRECATED] IsSpellKnown
  Replaced by: C_SpellBook.IsSpellInSpellBook
  Replacement docs: https://warcraft.wiki.gg/wiki/API_C_SpellBook.IsSpellInSpellBook
  Parameters:
    spellID: number
    isPet: boolean
  Returns:
    isInSpellBook: boolean

> lookup_api("C_SpellBook.IsSpellKnown")

C_SpellBook.IsSpellKnown
  Description: Returns true if a player knows a spell...
  Wiki: https://warcraft.wiki.gg/wiki/API_C_SpellBook.IsSpellKnown
  Game versions: Mainline, Vanilla, Mists
  Parameters:
    spellID: number
    spellBank?: Enum.SpellBookSpellBank -- Default = Player
  Returns:
    isKnown: boolean

> list_deprecated("Spell")

9 deprecated function(s) matching "Spell":
IsSpellOverlayed -> C_SpellActivationOverlay.IsSpellOverlayed [patch 11.2.0]
IsPlayerSpell -> C_SpellBook.IsSpellKnown
IsSpellKnown -> C_SpellBook.IsSpellInSpellBook
...

> get_enum("SpellBookSpellBank")

Enum.SpellBookSpellBank:
  Player = 0
  Pet = 1
```

## Updating

The MCP server reads from the installed VS Code extension at startup. When the extension updates (typically with major WoW patches):

1. Update the extension in VS Code
2. Restart your MCP client (Claude Code, Claude Desktop, etc.)

The server will automatically pick up the latest version of the extension.

## License

MIT
