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
        // Una barra inicial ancla el patrón a la raíz local (estilo gitignore):
        // así casa solo en el primer nivel, no a cualquier profundidad.
        let anchored = raw.trim().starts_with('/');
        let p = raw.trim().trim_matches('/');
        if p.is_empty() {
            continue;
        }
        for variant in expand(p, anchored) {
            // Patrones inválidos no deben tumbar la sincronización entera.
            if let Ok(glob) = Glob::new(&variant) {
                builder.add(glob);
            }
        }
    }
    Ok(builder.build()?)
}

/// Expande un patrón a las variantes necesarias para casar como gitignore.
///
/// Si `anchored` es `true` (el patrón venía con barra inicial), solo casa en el
/// primer nivel: no se añaden las variantes `**/...` que buscan en subniveles.
fn expand(p: &str, anchored: bool) -> Vec<String> {
    let has_glob = p.contains('*') || p.contains('?') || p.contains('[');
    if anchored {
        // Anclado a la raíz: sin búsqueda en subdirectorios.
        if has_glob {
            return vec![p.to_string()];
        }
        // Nombre simple anclado: la carpeta del primer nivel y su contenido.
        return vec![p.to_string(), format!("{p}/**")];
    }
    // Si ya contiene un glob explícito (`*`, `?`, `[`), respetamos al usuario
    // y solo añadimos la variante "en cualquier subdirectorio".
    if has_glob {
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
    for raw in meaningful {
        // Barra inicial = anclado a la raíz (igual que en los patrones ignore).
        let anchored = raw.starts_with('/');
        let p = raw.trim_matches('/');
        if p.is_empty() {
            continue;
        }
        if let Ok(glob) = Glob::new(p) {
            builder.add(glob);
        }
        // Un patrón suelto (sin barra y sin anclar) también casa a cualquier
        // profundidad: p. ej. `*.php` incluye los .php de cualquier subcarpeta.
        if !anchored && !p.contains('/') {
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

#[cfg(test)]
mod tests {
    use super::*;

    // Atajo para construir el set de ignore con un solo patrón.
    fn ign(patron: &str) -> GlobSet {
        build(&[patron.to_string()]).unwrap()
    }

    #[test]
    fn ignore_sin_barra_casa_en_cualquier_nivel() {
        let set = ign("logs");
        assert!(is_ignored(&set, "logs"));
        assert!(is_ignored(&set, "logs/salida.txt"));
        assert!(is_ignored(&set, "src/modulo/logs"));
        assert!(is_ignored(&set, "src/modulo/logs/salida.txt"));
        assert!(!is_ignored(&set, "src/app.js"));
    }

    #[test]
    fn ignore_anclado_solo_primer_nivel() {
        let set = ign("/logs");
        // La carpeta del primer nivel y su contenido sí.
        assert!(is_ignored(&set, "logs"));
        assert!(is_ignored(&set, "logs/salida.txt"));
        // La misma carpeta en profundidad NO.
        assert!(!is_ignored(&set, "src/modulo/logs"));
        assert!(!is_ignored(&set, "src/modulo/logs/salida.txt"));
    }

    #[test]
    fn ignore_anclado_con_comodin() {
        let set = ign("/dist/*.map");
        assert!(is_ignored(&set, "dist/app.map"));
        assert!(!is_ignored(&set, "src/dist/app.map"));
    }

    #[test]
    fn include_sin_barra_casa_en_cualquier_nivel() {
        let set = build_include(&["*.php".to_string()]).unwrap();
        assert!(is_included(&set, "index.php"));
        assert!(is_included(&set, "src/modulo/vista.php"));
        assert!(!is_included(&set, "src/app.js"));
    }

    #[test]
    fn include_anclado_solo_primer_nivel() {
        let set = build_include(&["/app.js".to_string()]).unwrap();
        assert!(is_included(&set, "app.js"));
        assert!(!is_included(&set, "src/app.js"));
    }

    #[test]
    fn include_vacio_o_todo_es_incluir_todo() {
        assert!(build_include(&[]).unwrap().is_none());
        assert!(build_include(&["**/*".to_string()]).unwrap().is_none());
    }
}
