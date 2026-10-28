// Developer tool: a made-up vault for checking how universes fill out. It
// never touches real notes; each roll gives new folders, notes, links and dates.

import { NoteInput } from "./universe";
import { makeRng } from "./planets/noise";

const FOLDERS = [
	"Projects", "Journal", "Ideas", "Reading", "Work", "Recipes", "Travel", "Archive", "School", "Music",
	"Health", "Finance", "Games", "Research", "Writing", "Code", "Garden", "People", "Meetings", "Inbox",
	"Photos", "Lists", "Quotes", "Dreams", "Fitness", "Movies", "Languages", "Home", "Clients", "Hobbies",
	"Poetry", "Science", "History", "Design", "Startup", "Podcasts", "Art", "Cooking", "Philosophy", "Chess",
	"Astronomy", "Courses", "Events", "Family", "Friends", "Habits", "Journaling", "Knowledge", "Maps", "Notes",
	"Plants", "Products", "Recordings", "Sketches", "Sports", "Stories", "Tools", "Trips", "Videos", "Wiki",
];
const TAGS = ["#idea", "#todo", "#draft", "#book", "#important", "#question", "#done", "#reference", "#person", "#project"];
const WORDS = ["Alpha", "Notes", "Plan", "Review", "Draft", "Summary", "Thoughts", "Log", "List", "Guide", "Sketch", "Outline"];

export interface FakeVault {
	notes: NoteInput[];
	links: Record<string, Record<string, number>>;
}

/** `scale` above 1 makes bigger universes: more folders and more notes in each. */
export function randomVault(seed: number, scale = 1): FakeVault {
	const rng = makeRng(seed);
	const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length)];
	const folderCount = Math.min(FOLDERS.length, Math.round((3 + Math.floor(rng() * 20)) * scale));
	const folders = [...FOLDERS].sort(() => rng() - 0.5).slice(0, folderCount);
	const now = Date.now();
	const notes: NoteInput[] = [];
	const add = (folder: string, i: number) => {
		const name = `${folder || "Loose"} ${pick(WORDS)} ${i + 1}`;
		const ctime = now - rng() * 3 * 365 * 86400e3;
		// A quarter of notes were touched in the last ten days.
		const mtime = rng() < 0.25 ? now - rng() * 10 * 86400e3 : ctime + rng() * (now - ctime);
		const tags = rng() < 0.6 ? [pick(TAGS)] : [];
		notes.push({ path: folder ? `${folder}/${name}.md` : `${name}.md`, name, folder, ctime, mtime, tags });
	};
	for (const folder of folders) {
		// Mostly small folders, now and then a big one.
		const count = 2 + Math.floor(Math.pow(rng(), 2.2) * 90 * Math.sqrt(scale));
		for (let i = 0; i < count; i++) add(folder, i);
	}
	const loose = Math.floor(rng() * 8);
	for (let i = 0; i < loose; i++) add("", i);

	const byFolder = new Map<string, NoteInput[]>();
	for (const n of notes) {
		const list = byFolder.get(n.folder);
		if (list) list.push(n);
		else byFolder.set(n.folder, [n]);
	}
	const links: Record<string, Record<string, number>> = {};
	for (const n of notes) {
		links[n.path] = {};
		// About one note in ten links to nothing (it becomes a rogue planet).
		const count = rng() < 0.1 ? 0 : 1 + Math.floor(rng() * 3);
		for (let k = 0; k < count; k++) {
			const local = byFolder.get(n.folder) ?? notes;
			const pool = rng() < 0.75 && local.length > 1 ? local : notes;
			const target = pick(pool);
			if (target !== n) links[n.path][target.path] = 1;
		}
	}
	return { notes, links };
}
