import {greet, shout} from './greet.js';

export function run(): void {
	console.log(greet('world'));
	console.log(shout('world'));
}
