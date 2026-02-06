import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

/**
 * Parse a LuaLS annotation file into structured function/class/enum data.
 * Handles: @param, @return, @deprecated, @class, @field, @enum, function signatures, wiki links, descriptions.
 */

/**
 * Parse a single annotation block (accumulated --- lines) + the function/class line that follows.
 */
function parseAnnotationBlock(lines, funcLine) {
	const result = {
		deprecated: false,
		replacedBy: null,
		replacedByUrl: null,
		wikiUrl: null,
		description: null,
		params: [],
		returns: [],
	};

	const descParts = [];

	for (const line of lines) {
		const text = line.replace(/^---\s?/, '');

		if (text === '@deprecated') {
			result.deprecated = true;
			continue;
		}

		// Deprecated by [Name](url)
		const deprecMatch = text.match(/^Deprecated by \[([^\]]+)\]\(([^)]+)\)/);
		if (deprecMatch) {
			result.replacedBy = deprecMatch[1];
			result.replacedByUrl = deprecMatch[2];
			continue;
		}

		// [Documentation](url)
		const docMatch = text.match(/^\[Documentation\]\(([^)]+)\)/);
		if (docMatch) {
			result.wikiUrl = docMatch[1];
			continue;
		}

		// @param name? type Description
		const paramMatch = text.match(/^@param\s+(\w+)(\?)?\s+(\S+)\s*(.*)?$/);
		if (paramMatch) {
			result.params.push({
				name: paramMatch[1],
				optional: !!paramMatch[2],
				type: paramMatch[3],
				description: paramMatch[4] || null,
			});
			continue;
		}

		// @return type name Description
		const returnMatch = text.match(/^@return\s+(\S+)\s*(\w+)?\s*(.*)?$/);
		if (returnMatch) {
			result.returns.push({
				type: returnMatch[1],
				name: returnMatch[2] || null,
				description: returnMatch[3] || null,
			});
			continue;
		}

		// Skip meta, class, field, enum, alias, overload, nopage, invalidpage markers in function context
		if (text.startsWith('@') || text.startsWith('#')) continue;

		// Everything else is description text
		if (text.trim()) {
			descParts.push(text.trim());
		}
	}

	result.description = descParts.length > 0 ? descParts.join(' ') : null;
	return result;
}

/**
 * Parse function signature line: `function C_NS.Func(args) end` or `function Widget:Method(args) end`
 */
function parseFunctionLine(line) {
	// function Namespace.Func(args) end
	const nsMatch = line.match(/^function\s+([\w.]+)\s*\(([^)]*)\)\s*end$/);
	if (nsMatch) {
		const fullName = nsMatch[1];
		const args = nsMatch[2];
		const dotIdx = fullName.lastIndexOf('.');
		if (dotIdx !== -1) {
			return {
				fullName,
				namespace: fullName.substring(0, dotIdx),
				name: fullName.substring(dotIdx + 1),
				args,
				isMethod: false,
			};
		}
		return {
			fullName,
			namespace: null,
			name: fullName,
			args,
			isMethod: false,
		};
	}

	// function Widget:Method(args) end
	const methodMatch = line.match(/^function\s+([\w.]+):([\w]+)\s*\(([^)]*)\)\s*end$/);
	if (methodMatch) {
		return {
			fullName: `${methodMatch[1]}:${methodMatch[2]}`,
			namespace: methodMatch[1],
			name: methodMatch[2],
			args: methodMatch[3],
			isMethod: true,
		};
	}

	return null;
}

/**
 * Parse all functions from a single .lua annotation file.
 */
export function parseLuaFile(filePath) {
	const content = readFileSync(filePath, 'utf-8');
	const lines = content.split(/\r?\n/);
	const functions = [];
	const classes = [];
	const enums = [];
	let annotationLines = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		// Accumulate annotation lines
		if (line.startsWith('---')) {
			annotationLines.push(line);
			continue;
		}

		// Function definition
		if (line.startsWith('function ')) {
			const funcInfo = parseFunctionLine(line);
			if (funcInfo) {
				const annotation = parseAnnotationBlock(annotationLines, line);
				functions.push({ ...funcInfo, ...annotation });
			}
			annotationLines = [];
			continue;
		}

		// Class definition: ---@class Name : Parent  (already in annotation lines)
		// Check if we have a class annotation followed by `local X = {}`
		if (annotationLines.length > 0) {
			for (const aLine of annotationLines) {
				const classMatch = aLine.match(/^---@class\s+([\w.]+)(?:\s*:\s*([\w.,\s]+))?/);
				if (classMatch) {
					const classDef = {
						name: classMatch[1],
						inherits: classMatch[2] ? classMatch[2].split(',').map((s) => s.trim()) : [],
						fields: [],
						wikiUrl: null,
					};
					// Gather fields from the annotation block
					for (const fLine of annotationLines) {
						const fieldMatch = fLine.match(/^---@field\s+(\w+)(\?)?\s+(\S+)\s*(.*)?$/);
						if (fieldMatch) {
							classDef.fields.push({
								name: fieldMatch[1],
								optional: !!fieldMatch[2],
								type: fieldMatch[3],
								description: fieldMatch[4] || null,
							});
						}
						const docMatch = fLine.match(/^---\[Documentation\]\(([^)]+)\)/);
						if (docMatch) {
							classDef.wikiUrl = docMatch[1];
						}
					}
					classes.push(classDef);
				}
			}
		}

		// Reset annotation accumulator on non-annotation, non-function lines
		if (!line.startsWith('---')) {
			annotationLines = [];
		}
	}

	return { functions, classes, enums };
}

/**
 * Parse enum definitions from Enum.lua.
 * Format:
 * ---@enum Enum.Name
 * Enum.Name = {
 *   Key = Value,
 *   ...
 * }
 */
export function parseEnumFile(filePath) {
	const content = readFileSync(filePath, 'utf-8');
	const lines = content.split(/\r?\n/);
	const enums = {};
	let currentEnum = null;
	let currentValues = {};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		const enumStart = line.match(/^---@enum\s+([\w.]+)/);
		if (enumStart) {
			currentEnum = enumStart[1];
			currentValues = {};
			continue;
		}

		if (currentEnum && line.match(/^[\w.]+ = \{$/)) {
			continue; // Opening brace
		}

		if (currentEnum && line === '}') {
			enums[currentEnum] = currentValues;
			currentEnum = null;
			currentValues = {};
			continue;
		}

		if (currentEnum) {
			const kvMatch = line.match(/^(\w+)\s*=\s*(\d+),?$/);
			if (kvMatch) {
				currentValues[kvMatch[1]] = parseInt(kvMatch[2], 10);
			}
		}
	}

	return enums;
}

/**
 * Parse event definitions from Event.lua.
 * Format:
 * ---@alias FrameEvent string
 * ---|"EVENT_NAME" # `param1, param2`
 */
export function parseEventFile(filePath) {
	const content = readFileSync(filePath, 'utf-8');
	const lines = content.split(/\r?\n/);
	const events = {};

	for (const line of lines) {
		const match = line.match(/^\s*---\|"([^"]+)"(?:\s*#\s*`([^`]*)`)?/);
		if (match) {
			events[match[1]] = {
				name: match[1],
				payload: match[2] || null,
			};
		}
	}

	return events;
}

/**
 * Parse CVar definitions from CVar.lua.
 * Format:
 * ---@alias CVar string
 * ---|"CVarName"
 */
export function parseCVarFile(filePath) {
	const content = readFileSync(filePath, 'utf-8');
	const lines = content.split(/\r?\n/);
	const cvars = [];

	for (const line of lines) {
		const match = line.match(/^\s*---\|"([^"]+)"/);
		if (match) {
			cvars.push(match[1]);
		}
	}

	return cvars;
}

/**
 * Recursively find all .lua files in a directory.
 */
export function findLuaFiles(dir) {
	const results = [];
	try {
		const entries = readdirSync(dir);
		for (const entry of entries) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				results.push(...findLuaFiles(fullPath));
			} else if (entry.endsWith('.lua')) {
				results.push(fullPath);
			}
		}
	} catch {
		// Directory doesn't exist, skip
	}
	return results;
}

/**
 * Extract deprecation patch version from filename like Deprecated_11_0_5.lua
 */
export function extractPatchFromFilename(filename) {
	const match = filename.match(/Deprecated_(\d+)_(\d+)_(\d+)/);
	if (match) {
		return `${match[1]}.${match[2]}.${match[3]}`;
	}
	return null;
}
