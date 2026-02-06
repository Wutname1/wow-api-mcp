import { readFileSync } from 'fs';

/**
 * Parse flavor.ts/flavor.js - version bitmask per function.
 * Format: exports.data = { ["FuncName"]: 0x7, ... }
 * Bitmask: 0x1 = Mainline, 0x2 = Vanilla, 0x4 = Mists
 */
export function parseFlavorFile(filePath) {
	const content = readFileSync(filePath, 'utf-8');

	// Extract key-value pairs: ["Name"]: 0xN
	const flavorMap = {};
	const regex = /\["([^"]+)"\]\s*:\s*(0x[0-9a-fA-F]+|\d+)/g;
	let match;
	while ((match = regex.exec(content)) !== null) {
		const name = match[1];
		const value = parseInt(match[2]);
		flavorMap[name] = decodeFlavorBitmask(value);
	}

	return flavorMap;
}

/**
 * Decode a flavor bitmask into an array of game version strings.
 */
function decodeFlavorBitmask(bitmask) {
	const versions = [];
	if (bitmask & 0x1) versions.push('Mainline');
	if (bitmask & 0x2) versions.push('Vanilla');
	if (bitmask & 0x4) versions.push('Mists');
	return versions;
}

/**
 * Parse deprecated.ts/deprecated.js - list of deprecated function names.
 * Format: exports.data = ["FuncName", ...]
 */
export function parseDeprecatedFile(filePath) {
	const content = readFileSync(filePath, 'utf-8');

	const deprecated = [];
	const regex = /"([^"]+)"/g;
	let match;
	// Skip the first match which is "__esModule"
	while ((match = regex.exec(content)) !== null) {
		const name = match[1];
		if (name !== '__esModule' && name !== 'use strict') {
			deprecated.push(name);
		}
	}

	return deprecated;
}
