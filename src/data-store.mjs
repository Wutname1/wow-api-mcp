import { join } from 'path';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { parseLuaFile, parseEnumFile, parseEventFile, parseCVarFile, findLuaFiles, extractPatchFromFilename } from './parsers/lua-annotations.mjs';
import { parseFlavorFile, parseDeprecatedFile } from './parsers/ts-data.mjs';

/**
 * Discover the ketho.wow-api extension path.
 *
 * Resolution order:
 * 1. WOW_API_EXT_PATH env var (explicit override, points to extension root)
 * 2. Auto-discover from VS Code extensions directories:
 *    - Default VS Code: ~/.vscode/extensions/
 *    - VS Code Insiders: ~/.vscode-insiders/extensions/
 *    - VS Code OSS: ~/.vscode-oss/extensions/
 *    - Cursor: ~/.cursor/extensions/
 */
function findExtensionPath() {
	// 1. Explicit override via env var
	if (process.env.WOW_API_EXT_PATH) {
		const extPath = process.env.WOW_API_EXT_PATH;
		if (existsSync(join(extPath, 'Annotations'))) {
			return extPath;
		}
		// Maybe they pointed to the extensions dir, not the specific extension
		return scanExtensionsDir(extPath);
	}

	// 2. Auto-discover from known VS Code extension directories
	const homeDir = process.env.USERPROFILE || process.env.HOME;
	const candidates = ['.vscode', '.vscode-insiders', '.vscode-oss', '.cursor'];

	for (const candidate of candidates) {
		const extensionsDir = join(homeDir, candidate, 'extensions');
		const result = scanExtensionsDir(extensionsDir);
		if (result) return result;
	}

	return null;
}

/**
 * Scan an extensions directory for the ketho.wow-api extension.
 * Returns the path to the latest version found, or null.
 */
function scanExtensionsDir(extensionsDir) {
	try {
		const entries = readdirSync(extensionsDir);
		const matches = entries
			.filter((e) => e.startsWith('ketho.wow-api-'))
			.sort()
			.reverse(); // Latest version first
		if (matches.length > 0) {
			return join(extensionsDir, matches[0]);
		}
	} catch {
		// Directory doesn't exist or not readable
	}
	return null;
}

export class DataStore {
	constructor() {
		// Indexed stores
		this.functions = new Map(); // fullName -> function data
		this.namespaces = new Map(); // namespace -> [function data]
		this.widgets = new Map(); // widget class -> { classInfo, methods: [function data] }
		this.enums = {}; // enum name -> { key: value }
		this.events = {}; // event name -> { name, payload }
		this.cvars = []; // string[]
		this.deprecatedList = new Set(); // names from deprecated.ts
		this.flavorMap = {}; // func name -> game versions[]
		this.extensionVersion = null;
	}

	/**
	 * Load all data from the VS Code extension.
	 */
	load() {
		const extPath = findExtensionPath();
		if (!extPath) {
			throw new Error(
				'Could not find ketho.wow-api VS Code extension.\n' +
					'Install it: code --install-extension ketho.wow-api\n' +
					'Or set WOW_API_EXT_PATH env var to the extension directory.'
			);
		}

		// Read extension version from package.json
		try {
			const pkg = JSON.parse(readFileSync(join(extPath, 'package.json'), 'utf-8'));
			this.extensionVersion = pkg.version;
		} catch {
			this.extensionVersion = 'unknown';
		}

		const annotationsCore = join(extPath, 'Annotations', 'Core');

		// 1. Parse flavor data (version bitmasks)
		const flavorPath = join(extPath, 'out', 'data', 'flavor.js');
		if (existsSync(flavorPath)) {
			this.flavorMap = parseFlavorFile(flavorPath);
		}

		// 2. Parse deprecated list
		const deprecatedPath = join(extPath, 'out', 'data', 'deprecated.js');
		if (existsSync(deprecatedPath)) {
			for (const name of parseDeprecatedFile(deprecatedPath)) {
				this.deprecatedList.add(name);
			}
		}

		// 3. Parse official Blizzard API documentation (C_ namespaces)
		const blizzDocDir = join(annotationsCore, 'Blizzard_APIDocumentationGenerated');
		for (const file of findLuaFiles(blizzDocDir)) {
			const { functions, classes } = parseLuaFile(file);
			for (const func of functions) {
				this._indexFunction(func, 'blizzard');
			}
			for (const cls of classes) {
				this._indexClass(cls);
			}
		}

		// 4. Parse deprecated API files
		const deprecatedDir = join(annotationsCore, 'FrameXML', 'Blizzard_Deprecated');
		for (const file of findLuaFiles(deprecatedDir)) {
			const patchVersion = extractPatchFromFilename(file);
			const { functions } = parseLuaFile(file);
			for (const func of functions) {
				func.deprecatedInPatch = patchVersion;
				func.deprecated = true; // Ensure marked
				this._indexFunction(func, 'deprecated');
			}
		}

		// 5. Parse Wiki-documented global functions
		const wikiPath = join(annotationsCore, 'Data', 'Wiki.lua');
		if (existsSync(wikiPath)) {
			const { functions } = parseLuaFile(wikiPath);
			for (const func of functions) {
				// Cross-reference with deprecated list
				if (this.deprecatedList.has(func.name || func.fullName)) {
					func.deprecated = true;
				}
				// Don't overwrite if we already have a better definition
				if (!this.functions.has(func.fullName)) {
					this._indexFunction(func, 'wiki');
				}
			}
		}

		// 6. Parse Widget API files
		const widgetDir = join(annotationsCore, 'Widget');
		for (const file of findLuaFiles(widgetDir)) {
			const { functions, classes } = parseLuaFile(file);
			for (const cls of classes) {
				this._indexClass(cls);
			}
			for (const func of functions) {
				this._indexFunction(func, 'widget');
				// Also index as widget methods
				if (func.isMethod && func.namespace) {
					if (!this.widgets.has(func.namespace)) {
						this.widgets.set(func.namespace, { methods: [] });
					}
					this.widgets.get(func.namespace).methods.push(func);
				}
			}
		}

		// 7. Parse FrameXML (non-deprecated) for additional mixins/methods
		const frameXmlDir = join(annotationsCore, 'FrameXML');
		const frameXmlSubdirs = ['Blizzard_FrameXML', 'Blizzard_ObjectAPI', 'Blizzard_SharedXML', 'Blizzard_Menu', 'Blizzard_NamePlates'];
		for (const subdir of frameXmlSubdirs) {
			const dir = join(frameXmlDir, subdir);
			if (existsSync(dir)) {
				for (const file of findLuaFiles(dir)) {
					const { functions, classes } = parseLuaFile(file);
					for (const cls of classes) {
						this._indexClass(cls);
					}
					for (const func of functions) {
						if (!this.functions.has(func.fullName)) {
							this._indexFunction(func, 'framexml');
						}
					}
				}
			}
		}

		// 8. Parse enums
		const enumPath = join(annotationsCore, 'Data', 'Enum.lua');
		if (existsSync(enumPath)) {
			this.enums = parseEnumFile(enumPath);
		}

		// 9. Parse events
		const eventPath = join(annotationsCore, 'Data', 'Event.lua');
		if (existsSync(eventPath)) {
			this.events = parseEventFile(eventPath);
		}

		// 10. Parse CVars
		const cvarPath = join(annotationsCore, 'Data', 'CVar.lua');
		if (existsSync(cvarPath)) {
			this.cvars = parseCVarFile(cvarPath);
		}

		// Apply flavor data to all indexed functions
		for (const [name, func] of this.functions) {
			const shortName = func.name || name;
			if (this.flavorMap[shortName]) {
				func.gameVersions = this.flavorMap[shortName];
			} else if (this.flavorMap[name]) {
				func.gameVersions = this.flavorMap[name];
			}
		}
	}

	_indexFunction(func, source) {
		func.source = source;
		if (!func.gameVersions) func.gameVersions = [];
		this.functions.set(func.fullName, func);

		// Index by namespace
		if (func.namespace && !func.isMethod) {
			if (!this.namespaces.has(func.namespace)) {
				this.namespaces.set(func.namespace, []);
			}
			this.namespaces.get(func.namespace).push(func);
		}
	}

	_indexClass(cls) {
		if (!this.widgets.has(cls.name)) {
			this.widgets.set(cls.name, { classInfo: cls, methods: [] });
		} else {
			this.widgets.get(cls.name).classInfo = cls;
		}
	}

	// ---- Query methods ----

	/**
	 * Look up a function by exact or partial name (case-insensitive).
	 */
	lookupApi(name) {
		// Exact match first
		if (this.functions.has(name)) {
			return [this.functions.get(name)];
		}

		// Case-insensitive exact match
		const lowerName = name.toLowerCase();
		for (const [key, func] of this.functions) {
			if (key.toLowerCase() === lowerName) {
				return [func];
			}
		}

		// Partial match on function name (not namespace)
		const results = [];
		for (const [key, func] of this.functions) {
			const shortName = func.name || key;
			if (shortName.toLowerCase() === lowerName || key.toLowerCase().includes(lowerName)) {
				results.push(func);
			}
		}

		return results.slice(0, 25);
	}

	/**
	 * Search functions by query string (searches name and description).
	 */
	searchApi(query) {
		const lowerQuery = query.toLowerCase();
		const results = [];

		for (const [, func] of this.functions) {
			const searchable = [func.fullName, func.name, func.description].filter(Boolean).join(' ').toLowerCase();

			if (searchable.includes(lowerQuery)) {
				results.push(func);
			}
		}

		return results.slice(0, 50);
	}

	/**
	 * List all deprecated functions.
	 */
	listDeprecated(namespaceFilter) {
		const results = [];

		for (const [, func] of this.functions) {
			if (!func.deprecated) continue;
			if (namespaceFilter && func.namespace && !func.namespace.toLowerCase().includes(namespaceFilter.toLowerCase())) continue;
			if (namespaceFilter && !func.namespace && !func.fullName.toLowerCase().includes(namespaceFilter.toLowerCase())) continue;
			results.push(func);
		}

		return results;
	}

	/**
	 * Get all functions in a namespace.
	 */
	getNamespace(name) {
		// Exact match
		if (this.namespaces.has(name)) {
			return this.namespaces.get(name);
		}

		// Case-insensitive
		const lowerName = name.toLowerCase();
		for (const [key, funcs] of this.namespaces) {
			if (key.toLowerCase() === lowerName) {
				return funcs;
			}
		}

		return [];
	}

	/**
	 * List all known namespaces.
	 */
	listNamespaces() {
		return [...this.namespaces.keys()].sort();
	}

	/**
	 * Get widget class info and methods.
	 */
	getWidgetMethods(widgetType) {
		// Exact match
		if (this.widgets.has(widgetType)) {
			return this.widgets.get(widgetType);
		}

		// Case-insensitive
		const lowerType = widgetType.toLowerCase();
		for (const [key, widget] of this.widgets) {
			if (key.toLowerCase() === lowerType) {
				return widget;
			}
		}

		return null;
	}

	/**
	 * List all known widget types.
	 */
	listWidgets() {
		return [...this.widgets.keys()].sort();
	}

	/**
	 * Get enum values.
	 */
	getEnum(name) {
		if (this.enums[name]) return this.enums[name];

		// Case-insensitive / partial match
		const lowerName = name.toLowerCase();
		for (const [key, values] of Object.entries(this.enums)) {
			if (key.toLowerCase() === lowerName || key.toLowerCase().includes(lowerName)) {
				return { [key]: values };
			}
		}

		return null;
	}

	/**
	 * Search enums by name.
	 */
	searchEnums(query) {
		const lowerQuery = query.toLowerCase();
		const results = {};
		for (const [key, values] of Object.entries(this.enums)) {
			if (key.toLowerCase().includes(lowerQuery)) {
				results[key] = values;
			}
		}
		return results;
	}

	/**
	 * Get event info.
	 */
	getEvent(name) {
		const upperName = name.toUpperCase();
		if (this.events[upperName]) return this.events[upperName];

		// Partial match
		const results = [];
		for (const [key, evt] of Object.entries(this.events)) {
			if (key.includes(upperName)) {
				results.push(evt);
			}
		}
		return results.length > 0 ? results : null;
	}

	/**
	 * Get stats about loaded data.
	 */
	getStats() {
		const deprecatedCount = [...this.functions.values()].filter((f) => f.deprecated).length;
		return {
			extensionVersion: this.extensionVersion,
			totalFunctions: this.functions.size,
			deprecatedFunctions: deprecatedCount,
			namespaces: this.namespaces.size,
			widgetTypes: this.widgets.size,
			enums: Object.keys(this.enums).length,
			events: Object.keys(this.events).length,
			cvars: this.cvars.length,
		};
	}
}
