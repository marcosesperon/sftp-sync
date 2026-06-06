//! Construcción del matcher de patrones `ignore`.
//!
//! La extensión de VS Code interpreta patrones como `.vscode`, `.git`,
//! `.github/**` o `.DS_Store` con semántica próxima a gitignore: un patrón
//! sin barras casa con un fichero/carpeta en cualquier nivel y, si es una
//! carpeta, con todo su contenido.
//!
//! `globset` casa contra la ruta completa, así que por cada patrón del usuario
//! generamos varias variantes para reproducir ese comportamiento.

use globset::{Glob, GlobSet, GlobSetBuilder};

/// Compila los patrones del usuario en un `GlobSet`.
///
/// Las rutas a comprobar deben pasarse siempre en estilo POSIX (`/`), relativas
/// a la raíz local. Ver [`is_ignored`].
pub fn build(patterns: &[String]) -> anyhow::Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for raw in patterns {
        let p = raw.trim().trim_matches('/');
        if p.is_empty() {
            continue;
        }
        for variant in expand(p) {
            // Patrones inválidos no deben tumbar la sincronización entera.
            if let Ok(glob) = Glob::new(&variant) {
                builder.add(glob);
            }
        }
    }
    Ok(builder.build()?)
}

/// Expande un patrón a las variantes necesarias para casar como gitignore.
fn expand(p: &str) -> Vec<String> {
    // Si ya contiene un glob explícito (`*`, `?`, `[`), respetamos al usuario
    // y solo añadimos la variante "en cualquier subdirectorio".
    if p.contains('*') || p.contains('?') || p.contains('[') {
        return vec![p.to_string(), format!("**/{p}")];
    }
    // Patrón simple (`.vscode`, `.git`, `.DS_Store`): casa el propio nombre en
    // cualquier nivel y, como carpeta, todo su contenido.
    vec![
        p.to_string(),
        format!("{p}/**"),
        format!("**/{p}"),
        format!("**/{p}/**"),
    ]
}

/// Devuelve `true` si `rel_posix` (ruta relativa en estilo POSIX) debe ignorarse.
pub fn is_ignored(set: &GlobSet, rel_posix: &str) -> bool {
    set.is_match(rel_posix)
}

/// Compila patrones de **inclusión** (qué ficheros sincronizar).
///
/// Devuelve `None` cuando equivale a "incluir todo" (lista vacía o que contiene
/// `**/*` / `**`), de modo que no se aplica ningún filtro. Por cada patrón sin
/// barra añade también la variante `**/patrón` para que, p. ej., `*.php` case a
/// cualquier profundidad.
pub fn build_include(patterns: &[String]) -> anyhow::Result<Option<GlobSet>> {
    let meaningful: Vec<&str> = patterns
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    if meaningful.is_empty() || meaningful.iter().any(|p| *p == "**/*" || *p == "**") {
        return Ok(None); // incluir todo
    }

    let mut builder = GlobSetBuilder::new();
    for p in meaningful {
        if let Ok(glob) = Glob::new(p) {
            builder.add(glob);
        }
        if !p.contains('/') {
            if let Ok(glob) = Glob::new(&format!("**/{p}")) {
                builder.add(glob);
            }
        }
    }
    Ok(Some(builder.build()?))
}

/// Devuelve `true` si `rel_posix` debe incluirse. `None` = incluir todo.
pub fn is_included(set: &Option<GlobSet>, rel_posix: &str) -> bool {
    match set {
        None => true,
        Some(s) => s.is_match(rel_posix),
    }
}
