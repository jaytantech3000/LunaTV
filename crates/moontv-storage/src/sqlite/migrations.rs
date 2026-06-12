#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SqliteMigration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

const MIGRATIONS: &[SqliteMigration] = &[SqliteMigration {
    version: 1,
    name: "init_desktop_foundation",
    sql: include_str!("migrations/0001_init.sql"),
}];

pub fn all() -> &'static [SqliteMigration] {
    MIGRATIONS
}

pub fn latest_version() -> i64 {
    MIGRATIONS
        .last()
        .map(|migration| migration.version)
        .unwrap_or(0)
}
