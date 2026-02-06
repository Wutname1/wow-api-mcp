#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DataStore } from './data-store.mjs';

// ---- Initialize data store ----
const store = new DataStore();
store.load();
const stats = store.getStats();

// ---- Format helpers ----

function formatFunction(func) {
	const lines = [];

	if (func.deprecated) {
		lines.push(`[DEPRECATED] ${func.fullName}`);
		if (func.replacedBy) {
			lines.push(`  Replaced by: ${func.replacedBy}`);
			if (func.replacedByUrl) lines.push(`  Replacement docs: ${func.replacedByUrl}`);
		}
		if (func.deprecatedInPatch) {
			lines.push(`  Deprecated in patch: ${func.deprecatedInPatch}`);
		}
	} else {
		lines.push(func.fullName);
	}

	if (func.description) lines.push(`  Description: ${func.description}`);
	if (func.wikiUrl) lines.push(`  Wiki: ${func.wikiUrl}`);
	if (func.gameVersions && func.gameVersions.length > 0) {
		lines.push(`  Game versions: ${func.gameVersions.join(', ')}`);
	}

	if (func.params.length > 0) {
		lines.push('  Parameters:');
		for (const p of func.params) {
			const opt = p.optional ? '?' : '';
			const desc = p.description ? ` -- ${p.description}` : '';
			lines.push(`    ${p.name}${opt}: ${p.type}${desc}`);
		}
	}

	if (func.returns.length > 0) {
		lines.push('  Returns:');
		for (const r of func.returns) {
			const name = r.name ? `${r.name}: ` : '';
			const desc = r.description ? ` -- ${r.description}` : '';
			lines.push(`    ${name}${r.type}${desc}`);
		}
	}

	return lines.join('\n');
}

function formatFunctionCompact(func) {
	const dep = func.deprecated ? '[DEPRECATED] ' : '';
	const replacement = func.replacedBy ? ` -> ${func.replacedBy}` : '';
	const params = func.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');
	const returns = func.returns.map((r) => r.type).join(', ');
	const retStr = returns ? ` -> ${returns}` : '';
	return `${dep}${func.fullName}(${params})${retStr}${replacement}`;
}

// ---- MCP Server ----

const server = new McpServer({
	name: 'wow-api',
	version: '1.0.0',
	description: `WoW API reference server (${stats.totalFunctions} functions, ${stats.deprecatedFunctions} deprecated, ${stats.namespaces} namespaces, ${stats.enums} enums, ${stats.events} events)`,
});

// Tool: lookup_api
server.tool(
	'lookup_api',
	'Look up a WoW API function by name (exact or partial match). Returns full signature, params, returns, deprecation status, replacement, wiki link, game versions.',
	{
		name: z.string().describe('Function name to look up (e.g. "IsSpellKnown", "C_SpellBook.IsSpellKnown")'),
	},
	async ({ name }) => {
		const results = store.lookupApi(name);
		if (results.length === 0) {
			return { content: [{ type: 'text', text: `No API function found matching "${name}".` }] };
		}

		const text = results.map(formatFunction).join('\n\n---\n\n');
		return { content: [{ type: 'text', text }] };
	}
);

// Tool: search_api
server.tool(
	'search_api',
	'Search WoW API functions by keyword. Searches function names and descriptions. Returns up to 50 results.',
	{
		query: z.string().describe('Search query (e.g. "spell", "unit frame", "achievement")'),
	},
	async ({ query }) => {
		const results = store.searchApi(query);
		if (results.length === 0) {
			return { content: [{ type: 'text', text: `No API functions found matching "${query}".` }] };
		}

		const text = [`Found ${results.length} result(s) for "${query}":\n`, ...results.map(formatFunctionCompact)].join('\n');
		return { content: [{ type: 'text', text }] };
	}
);

// Tool: list_deprecated
server.tool(
	'list_deprecated',
	'List all deprecated WoW API functions with their replacements. Optionally filter by namespace or function name.',
	{
		filter: z.string().optional().describe('Optional filter by namespace or function name (e.g. "Spell", "Item", "Guild")'),
	},
	async ({ filter }) => {
		const results = store.listDeprecated(filter);
		if (results.length === 0) {
			const filterMsg = filter ? ` matching "${filter}"` : '';
			return { content: [{ type: 'text', text: `No deprecated functions found${filterMsg}.` }] };
		}

		const lines = [`${results.length} deprecated function(s)${filter ? ` matching "${filter}"` : ''}:\n`];
		for (const func of results) {
			const replacement = func.replacedBy ? ` -> ${func.replacedBy}` : ' (no replacement listed)';
			const patch = func.deprecatedInPatch ? ` [patch ${func.deprecatedInPatch}]` : '';
			lines.push(`${func.fullName}${replacement}${patch}`);
		}

		return { content: [{ type: 'text', text: lines.join('\n') }] };
	}
);

// Tool: get_namespace
server.tool(
	'get_namespace',
	'Get all functions in a WoW API namespace (e.g. "C_SpellBook", "C_Item"). Pass "list" to see all available namespaces.',
	{
		name: z.string().describe('Namespace name (e.g. "C_SpellBook") or "list" to see all namespaces'),
	},
	async ({ name }) => {
		if (name.toLowerCase() === 'list') {
			const namespaces = store.listNamespaces();
			return { content: [{ type: 'text', text: `${namespaces.length} namespaces:\n\n${namespaces.join('\n')}` }] };
		}

		const functions = store.getNamespace(name);
		if (functions.length === 0) {
			return { content: [{ type: 'text', text: `No namespace found matching "${name}". Use name="list" to see all namespaces.` }] };
		}

		const text = [`Namespace: ${functions[0]?.namespace || name} (${functions.length} functions)\n`, ...functions.map(formatFunction)].join('\n\n');
		return { content: [{ type: 'text', text }] };
	}
);

// Tool: get_widget_methods
server.tool(
	'get_widget_methods',
	'Get all methods for a WoW UI widget class (e.g. "Frame", "Button", "ScriptRegion"). Pass "list" to see all widget types.',
	{
		widget_type: z.string().describe('Widget type name (e.g. "Frame", "Button") or "list" to see all widget types'),
	},
	async ({ widget_type }) => {
		if (widget_type.toLowerCase() === 'list') {
			const widgets = store.listWidgets();
			return { content: [{ type: 'text', text: `${widgets.length} widget types:\n\n${widgets.join('\n')}` }] };
		}

		const widget = store.getWidgetMethods(widget_type);
		if (!widget) {
			return { content: [{ type: 'text', text: `No widget type found matching "${widget_type}". Use widget_type="list" to see all types.` }] };
		}

		const lines = [];
		if (widget.classInfo) {
			lines.push(`Widget: ${widget.classInfo.name}`);
			if (widget.classInfo.inherits?.length > 0) {
				lines.push(`Inherits: ${widget.classInfo.inherits.join(', ')}`);
			}
			if (widget.classInfo.wikiUrl) {
				lines.push(`Wiki: ${widget.classInfo.wikiUrl}`);
			}
			if (widget.classInfo.fields?.length > 0) {
				lines.push('\nFields:');
				for (const f of widget.classInfo.fields) {
					lines.push(`  ${f.name}${f.optional ? '?' : ''}: ${f.type}${f.description ? ` -- ${f.description}` : ''}`);
				}
			}
		}

		if (widget.methods?.length > 0) {
			lines.push(`\nMethods (${widget.methods.length}):\n`);
			for (const m of widget.methods) {
				lines.push(formatFunction(m));
				lines.push('');
			}
		}

		return { content: [{ type: 'text', text: lines.join('\n') }] };
	}
);

// Tool: get_enum
server.tool(
	'get_enum',
	'Look up a WoW enum and its values (e.g. "Enum.SpellBookSpellBank"). Supports partial name matching.',
	{
		name: z.string().describe('Enum name (e.g. "Enum.SpellBookSpellBank", "SpellBookSpellBank")'),
	},
	async ({ name }) => {
		const result = store.getEnum(name);
		if (!result) {
			// Try searching
			const searchResults = store.searchEnums(name);
			if (Object.keys(searchResults).length === 0) {
				return { content: [{ type: 'text', text: `No enum found matching "${name}".` }] };
			}

			const lines = [`Enums matching "${name}":\n`];
			for (const [enumName, values] of Object.entries(searchResults)) {
				lines.push(`${enumName}:`);
				for (const [key, val] of Object.entries(values)) {
					lines.push(`  ${key} = ${val}`);
				}
				lines.push('');
			}
			return { content: [{ type: 'text', text: lines.join('\n') }] };
		}

		// Direct match - could be { key: value } or { enumName: { key: value } }
		const lines = [];
		if (typeof Object.values(result)[0] === 'object') {
			// Multiple enums matched
			for (const [enumName, values] of Object.entries(result)) {
				lines.push(`${enumName}:`);
				for (const [key, val] of Object.entries(values)) {
					lines.push(`  ${key} = ${val}`);
				}
				lines.push('');
			}
		} else {
			lines.push(`${name}:`);
			for (const [key, val] of Object.entries(result)) {
				lines.push(`  ${key} = ${val}`);
			}
		}

		return { content: [{ type: 'text', text: lines.join('\n') }] };
	}
);

// Tool: get_event
server.tool(
	'get_event',
	'Look up a WoW frame event and its payload parameters (e.g. "PLAYER_LOGIN", "ADDON_LOADED"). Supports partial name matching.',
	{
		name: z.string().describe('Event name (e.g. "PLAYER_LOGIN", "ADDON_LOADED", "SPELL")'),
	},
	async ({ name }) => {
		const result = store.getEvent(name);
		if (!result) {
			return { content: [{ type: 'text', text: `No event found matching "${name}".` }] };
		}

		if (Array.isArray(result)) {
			const lines = [`Events matching "${name}" (${result.length} results):\n`];
			for (const evt of result) {
				const payload = evt.payload ? ` -- payload: ${evt.payload}` : ' -- no payload';
				lines.push(`${evt.name}${payload}`);
			}
			return { content: [{ type: 'text', text: lines.join('\n') }] };
		}

		const payload = result.payload ? `Payload: ${result.payload}` : 'No payload parameters';
		return { content: [{ type: 'text', text: `Event: ${result.name}\n${payload}` }] };
	}
);

// ---- Start server ----
const transport = new StdioServerTransport();
await server.connect(transport);
