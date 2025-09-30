import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  try {
    await client.connect();
    const res = await client.query('SELECT NOW()');
    console.log("Connexion OK ✅ :", res.rows[0]);
  } catch (err) {
    console.error("Erreur connexion ❌ :", err);
  } finally {
    await client.end();
  }
}

main();