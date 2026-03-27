import Database from '@tauri-apps/plugin-sql';

let dbPromise: Promise<Database> | null = null;

export const getDb = async () => {
    if (!dbPromise) {
        console.log("Loading DB...");
        dbPromise = Database.load('sqlite:chatmemo.db').then(db => {
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

export interface Memo {
    id: number;
    content: string;
    created_at: string;
}

export interface Tag {
    id: number;
    name: string;
}

export const addMemo = async (content: string, tags: string[]): Promise<number> => {
    const db = await getDb();
    
    // Insert memo
    const result = await db.execute(
        'INSERT INTO memos (content) VALUES ($1)',
        [content]
    );
    const memoId = result.lastInsertId || 0;

    if (tags.length > 0) {
        for (const tagName of tags) {
            // Insert tag if not exists
            await db.execute(
                'INSERT OR IGNORE INTO tags (name) VALUES ($1)',
                [tagName]
            );
            
            // Get tag id
            const tagRes = await db.select<{id: number}[]>('SELECT id FROM tags WHERE name = $1', [tagName]);
            if (tagRes.length > 0) {
                const tagId = tagRes[0].id;
                // Link memo and tag
                await db.execute(
                    'INSERT INTO memo_tags (memo_id, tag_id) VALUES ($1, $2)',
                    [memoId, tagId]
                );
            }
        }
    }
    return memoId;
};

export const getMemos = async (): Promise<Memo[]> => {
    const db = await getDb();
    return db.select<Memo[]>('SELECT * FROM memos ORDER BY created_at ASC');
};

export const getMemosByDate = async (dateStr: string): Promise<Memo[]> => {
    // dateStr in YYYY-MM-DD format
    const db = await getDb();
    return db.select<Memo[]>(
        "SELECT * FROM memos WHERE date(created_at) = date($1) ORDER BY created_at ASC",
        [dateStr]
    );
};

export const getMemosByQuery = async (query: string): Promise<Memo[]> => {
    const db = await getDb();
    const searchQuery = `%${query}%`;
    return db.select<Memo[]>(
        "SELECT * FROM memos WHERE content LIKE $1 ORDER BY created_at ASC",
        [searchQuery]
    );
};

export const getMemosByTag = async (tag: string): Promise<Memo[]> => {
    const db = await getDb();
    // Assuming tag string does not have the # prefix when querying
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
    return res.map(r => r.date);
};
