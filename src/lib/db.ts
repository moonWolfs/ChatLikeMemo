import Database from '@tauri-apps/plugin-sql';
import { appDataDir, join } from '@tauri-apps/api/path';
import { mkdir, exists, readTextFile, writeTextFile, copyFile, readDir, remove } from '@tauri-apps/plugin-fs';

let dbPromise: Promise<Database> | null = null;
let cachedConfig: { customDataDir?: string } | null = null;

export const getConfig = async (): Promise<{ customDataDir?: string }> => {
    if (cachedConfig) return cachedConfig;
    try {
        const appData = await appDataDir();
        const configPath = await join(appData, 'config.json');
        if (await exists(configPath)) {
            const content = await readTextFile(configPath);
            cachedConfig = JSON.parse(content);
            return cachedConfig!;
        }
    } catch (e) {
        console.warn("No custom config found or error reading", e);
    }
    return {};
};

export const migrateDataDirectory = async (newPath: string) => {
    const config = await getConfig();
    const appData = await appDataDir();
    const currentRoot = config.customDataDir || appData;
    
    // Copy DB files (including SHM and WAL for sqlite)
    const files = ['chatmemo.db', 'chatmemo.db-wal', 'chatmemo.db-shm'];
    for (const file of files) {
        const currentPath = await join(currentRoot, file);
        const newDbPath = await join(newPath, file);
        if (await exists(currentPath)) {
            await copyFile(currentPath, newDbPath);
        }
    }

    // Copy Media
    const currentMediaDir = await join(currentRoot, 'media');
    const newMediaDir = await join(newPath, 'media');
    if (await exists(currentMediaDir)) {
        if (!await exists(newMediaDir)) {
            await mkdir(newMediaDir, { recursive: true });
        }
        const entries = await readDir(currentMediaDir);
        for (const entry of entries) {
            if (entry.isFile) {
                await copyFile(
                    await join(currentMediaDir, entry.name),
                    await join(newMediaDir, entry.name)
                );
            }
        }
    }

    // Save configuration
    const configPath = await join(appData, 'config.json');
    await writeTextFile(configPath, JSON.stringify({ customDataDir: newPath }));
};

export const getDb = async () => {
    if (!dbPromise) {
        console.log("Loading DB...");
        dbPromise = getConfig().then(config => {
            const dbPath = config.customDataDir 
                ? `sqlite:${config.customDataDir}/chatmemo.db`
                : 'sqlite:chatmemo.db';
            return Database.load(dbPath);
        }).then(db => {
            console.log("DB Loaded successfully!");
            return db;
        }).catch((e: any) => {
            console.error("Failed to load DB in getDb", e);
            alert(`DB Load Error: ${e?.message || e}`);
            dbPromise = null;
            throw e;
        });
    }
    return dbPromise;
};

export interface Media {
    id: number;
    memo_id: number;
    file_path: string;
    media_type: 'image' | 'video';
}

export interface Memo {
    id: number;
    content: string;
    created_at: string;
    is_starred?: number;
    media?: Media[];
}

export interface Tag {
    id: number;
    name: string;
}

const hydrateMemosWithMedia = async (memos: Memo[]) => {
    if (memos.length === 0) return memos;
    const db = await getDb();
    const memoIds = memos.map((m: Memo) => m.id);
    const mediaRes = await db.select<Media[]>(`SELECT * FROM memo_media WHERE memo_id IN (${memoIds.join(',')})`);
    
    return memos.map((memo: Memo) => ({
        ...memo,
        media: mediaRes.filter((m: Media) => m.memo_id === memo.id)
    }));
};

export const saveMediaFile = async (source: File | string): Promise<string> => {
    try {
        const config = await getConfig();
        const rootDir = config.customDataDir || await appDataDir();
        const mediaDir = await join(rootDir, 'media');
        
        const dirExists = await exists(mediaDir);
        if (!dirExists) {
            await mkdir(mediaDir, { recursive: true });
        }
        
        let ext = 'tmp';
        let fileName = '';
        const filePath = await join(mediaDir, `${Date.now()}_${Math.random().toString(36).substring(7)}`);

        if (typeof source === 'string') {
            // Absolute path
            const parts = source.split('.');
            if (parts.length > 1) ext = parts.pop() || 'tmp';
            fileName = `${filePath}.${ext}`;
            const { copyFile } = await import('@tauri-apps/plugin-fs');
            await copyFile(source, fileName);
            return fileName;
        } else {
            // Web File object
            ext = source.name.split('.').pop() || 'tmp';
            fileName = `${filePath}.${ext}`;
            const arrayBuffer = await source.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const { writeFile } = await import('@tauri-apps/plugin-fs');
            await writeFile(fileName, uint8Array);
            return fileName;
        }
    } catch (e) {
        console.error("Failed to save media file", e);
        throw e;
    }
};

export const addMemo = async (content: string, tags: string[], mediaFiles: {path: string, type: 'image'|'video'}[] = []): Promise<number> => {
    const db = await getDb();
    
    // Insert memo
    const result = await db.execute(
        'INSERT INTO memos (content) VALUES ($1)',
        [content]
    );
    const memoId = result.lastInsertId || 0;

    if (tags.length > 0) {
        for (const tagName of tags) {
            await db.execute('INSERT OR IGNORE INTO tags (name) VALUES ($1)', [tagName]);
            const tagRes = await db.select<{id: number}[]>('SELECT id FROM tags WHERE name = $1', [tagName]);
            if (tagRes.length > 0) {
                const tagId = tagRes[0].id;
                await db.execute('INSERT INTO memo_tags (memo_id, tag_id) VALUES ($1, $2)', [memoId, tagId]);
            }
        }
    }

    if (mediaFiles.length > 0) {
        for (const m of mediaFiles) {
            await db.execute('INSERT INTO memo_media (memo_id, file_path, media_type) VALUES ($1, $2, $3)', [memoId, m.path, m.type]);
        }
    }

    return memoId;
};

export const getMemos = async (): Promise<Memo[]> => {
    const db = await getDb();
    const memos = await db.select<Memo[]>('SELECT * FROM memos ORDER BY created_at ASC');
    return hydrateMemosWithMedia(memos);
};

export const getMemosByDate = async (dateStr: string): Promise<Memo[]> => {
    const db = await getDb();
    const memos = await db.select<Memo[]>(
        "SELECT * FROM memos WHERE date(created_at) = date($1) ORDER BY created_at ASC",
        [dateStr]
    );
    return hydrateMemosWithMedia(memos);
};

export const getMemosByQuery = async (query: string): Promise<Memo[]> => {
    const db = await getDb();
    const searchQuery = `%${query}%`;
    const memos = await db.select<Memo[]>(
        "SELECT * FROM memos WHERE content LIKE $1 ORDER BY created_at ASC",
        [searchQuery]
    );
    return hydrateMemosWithMedia(memos);
};

export const getMemosByTag = async (tag: string): Promise<Memo[]> => {
    const db = await getDb();
    const memos = await selectMemosByTag(db, tag);
    return hydrateMemosWithMedia(memos);
};

// Helper for Tag querying to resolve nested query safely
const selectMemosByTag = async (db: Database, tag: string) => {
    return db.select<Memo[]>(
        `SELECT m.* FROM memos m
         JOIN memo_tags mt ON m.id = mt.memo_id
         JOIN tags t ON mt.tag_id = t.id
         WHERE t.name = $1
         ORDER BY m.created_at ASC`,
        [tag]
    );
};

export const getDatesWithMemos = async (): Promise<string[]> => {
    const db = await getDb();
    const res = await db.select<{date: string}[]>(
        "SELECT DISTINCT date(created_at) as date FROM memos"
    );
    return res.map((r: {date: string}) => r.date);
};

export const getAllTags = async (): Promise<Tag[]> => {
    const db = await getDb();
    // Only return tags that actually have associated memos
    return db.select<Tag[]>(
        "SELECT DISTINCT t.* FROM tags t JOIN memo_tags mt ON t.id = mt.tag_id ORDER BY t.name ASC"
    );
};

export const deleteMemo = async (id: number): Promise<void> => {
    const db = await getDb();
    
    // 1. Fetch related media files to delete physically
    const mediaRes = await db.select<Media[]>('SELECT * FROM memo_media WHERE memo_id = $1', [id]);
    for (const m of mediaRes) {
        try {
            await remove(m.file_path);
        } catch (e) {
            console.warn("Failed to physically remove media", e);
        }
    }

    // 2. Delete mappings
    await db.execute('DELETE FROM memo_media WHERE memo_id = $1', [id]);
    await db.execute('DELETE FROM memo_tags WHERE memo_id = $1', [id]);
    
    // 3. Delete memo
    await db.execute('DELETE FROM memos WHERE id = $1', [id]);
};

export const updateMemoContent = async (id: number, newContent: string, newTags: string[]): Promise<void> => {
    const db = await getDb();
    
    // Update content
    await db.execute('UPDATE memos SET content = $1 WHERE id = $2', [newContent, id]);

    // Update tags
    await db.execute('DELETE FROM memo_tags WHERE memo_id = $1', [id]);
    
    if (newTags.length > 0) {
        for (const tagName of newTags) {
            await db.execute('INSERT OR IGNORE INTO tags (name) VALUES ($1)', [tagName]);
            const tagRes = await db.select<{id: number}[]>('SELECT id FROM tags WHERE name = $1', [tagName]);
            if (tagRes.length > 0) {
                const tagId = tagRes[0].id;
                await db.execute('INSERT INTO memo_tags (memo_id, tag_id) VALUES ($1, $2)', [id, tagId]);
            }
        }
    }
};

export const toggleMemoStar = async (id: number, currentStatus: number): Promise<void> => {
    const db = await getDb();
    await db.execute('UPDATE memos SET is_starred = $1 WHERE id = $2', [currentStatus ? 0 : 1, id]);
};

export const getStarredMemos = async (): Promise<Memo[]> => {
    const db = await getDb();
    const memos = await db.select<Memo[]>('SELECT * FROM memos WHERE is_starred = 1 ORDER BY created_at ASC');
    return hydrateMemosWithMedia(memos);
};
