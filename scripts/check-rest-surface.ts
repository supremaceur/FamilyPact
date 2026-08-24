/**
 * Verifie — et referme si necessaire — la surface REST de la base.
 *
 * POURQUOI CE SCRIPT EXISTE.
 * Supabase expose par defaut toutes les tables du schema `public` via PostgREST.
 * La cle `anon` est PUBLIQUE par conception (elle est livree aux navigateurs) et
 * la cle `service_role` CONTOURNE la securite au niveau des lignes. Une table
 * ajoutee par une migration herite des privileges par defaut et devient donc
 * lisible de l'exterieur, sans que personne ne l'ait voulu.
 *
 * Les tables de FamiliPact contiennent des empreintes de mots de passe, des
 * secrets TOTP chiffres, des jetons de session et les donnees de mineurs. Une
 * exposition accidentelle n'est pas un desagrement : c'est une fuite.
 *
 * FamiliPact n'utilise NI PostgREST, NI Supabase Auth — il se connecte a
 * PostgreSQL en direct. Ces privileges n'ont donc aucune contrepartie : le bon
 * etat est « aucun privilege pour ces trois roles », et il est retabli ici.
 *
 * Le script est idempotent : sur une base deja saine, il ne change rien.
 */
import 'dotenv/config';
import { Client } from 'pg';

const ROLES_EXPOSES = ['anon', 'authenticated', 'service_role'] as const;

interface Anomalie {
  readonly type: 'privilege' | 'rls';
  readonly detail: string;
}

const main = async (): Promise<void> => {
  const connectionString = process.env['DIRECT_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
  if (connectionString.length === 0) {
    console.error('DIRECT_DATABASE_URL ou DATABASE_URL est obligatoire.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const anomalies: Anomalie[] = [];

    // 1. Des privileges subsistent-ils pour les roles exposes ?
    const privileges = await client.query<{ grantee: string; table_name: string }>(
      `SELECT DISTINCT grantee, table_name
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND grantee = ANY($1)
        ORDER BY grantee, table_name`,
      [ROLES_EXPOSES],
    );
    for (const ligne of privileges.rows) {
      anomalies.push({
        type: 'privilege',
        detail: `${ligne.grantee} dispose de privileges sur "${ligne.table_name}"`,
      });
    }

    // 2. La securite au niveau des lignes est-elle active partout ?
    //    C'est la seconde barriere, independante des privileges.
    const sansRls = await client.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
        ORDER BY c.relname`,
    );
    for (const ligne of sansRls.rows) {
      anomalies.push({ type: 'rls', detail: `RLS inactive sur "${ligne.relname}"` });
    }

    if (anomalies.length === 0) {
      const total = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      );
      console.log(
        `Surface REST fermee : ${total.rows[0]?.n ?? '?'} table(s), aucun privilege pour ${ROLES_EXPOSES.join(', ')}, RLS active partout.`,
      );
      return;
    }

    console.warn(`${anomalies.length} anomalie(s) detectee(s) — correction en cours :`);
    for (const anomalie of anomalies) console.warn(`  - ${anomalie.detail}`);

    // 3. Retablissement de l'etat sur. Toutes ces instructions sont idempotentes.
    await client.query('BEGIN');
    for (const table of sansRls.rows) {
      await client.query(
        `ALTER TABLE public.${quoteIdentifier(table.relname)} ENABLE ROW LEVEL SECURITY`,
      );
    }
    const roles = ROLES_EXPOSES.join(', ');
    await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM ${roles}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${roles}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${roles}`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${roles}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${roles}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM ${roles}`,
    );
    await client.query('COMMIT');

    // 4. Re-verification : on ne se contente pas d'avoir lance les corrections.
    const restant = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND grantee = ANY($1)`,
      [ROLES_EXPOSES],
    );
    if (restant.rows[0]?.n !== '0') {
      console.error(
        `Echec : ${restant.rows[0]?.n} privilege(s) subsistent apres correction. Intervention manuelle requise.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log('Surface REST refermee et verifiee.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

/** Echappe un identifiant SQL : les noms de tables viennent du catalogue, mais
 *  les interpoler sans precaution reste une mauvaise habitude. */
const quoteIdentifier = (name: string): string => `"${name.replace(/"/g, '""')}"`;

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
