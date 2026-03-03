const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

function getMongoConfig() {
	const uri = process.env.MONGODB_URI;
	const dbName =
		process.env.MONGODB_DB_NAME && process.env.MONGODB_DB_NAME.trim()
			? process.env.MONGODB_DB_NAME.trim()
			: 'moltbook_agent';

	if (!uri) {
		throw new Error(
			'MONGODB_URI tidak ter-set di environment. Tambahkan ke .env untuk mengaktifkan sinkronisasi MongoDB.',
		);
	}

	return { uri, dbName };
}

async function getClient() {
	if (
		cachedClient &&
		cachedClient.topology &&
		cachedClient.topology.isConnected &&
		cachedClient.topology.isConnected()
	) {
		return cachedClient;
	}

	const { uri } = getMongoConfig();
	const client = new MongoClient(uri, {
		maxPoolSize: 5,
	});

	await client.connect();
	cachedClient = client;
	return client;
}

async function getDb() {
	if (cachedDb) return cachedDb;
	const client = await getClient();
	const { dbName } = getMongoConfig();
	cachedDb = client.db(dbName);
	return cachedDb;
}

async function getCollection(name) {
	const db = await getDb();
	return db.collection(name);
}

module.exports = {
	getDb,
	getCollection,
};
