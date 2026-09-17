-- ============================================================
-- 0048 HORAS: la ventana normal de registro pasa de 7 a 15 días
-- ------------------------------------------------------------
-- Sin permiso ampliado (profiles.registro_dias_atras en null), una persona podía
-- registrar, editar y anular hasta 7 días hacia atrás. Pasa a 15. Los permisos
-- ampliados que ya existen no cambian y los admin siguen sin límite.
--
-- El 7 vive en dos funciones: guardar_registro (0044) y anular_registro_diario (0043).
-- En vez de copiar aquí sus cuerpos enteros (guardar_registro pasa de 8.000 caracteres
-- y una copia a mano es fácil de desviar de lo que hay en producción), se toma la
-- definición vigente de cada una y se cambia solo ese literal. Si no aparece
-- exactamente una vez, la migración falla sin tocar nada.
--
-- En la app el mismo valor es DIAS_REGISTRO_POR_DEFECTO (lib/horas/ventana-registro.ts):
-- los dos tienen que coincidir.
-- ============================================================

do $$
declare
  f     regprocedure;
  def   text;
  viejo constant text := 'coalesce(v_dias_atras, 7)';
  n     int;
begin
  foreach f in array array[
    'public.guardar_registro(uuid, jsonb)'::regprocedure,
    'public.anular_registro_diario(uuid)'::regprocedure
  ] loop
    def := pg_get_functiondef(f);
    n := (length(def) - length(replace(def, viejo, ''))) / length(viejo);
    if n <> 1 then
      raise exception '0048: % contiene % veces «%», se esperaba 1', f, n, viejo;
    end if;
    def := replace(def, viejo, 'coalesce(v_dias_atras, 15)');
    def := replace(def, 'Piso mínimo de registro (no-admin): 7 días', 'Piso mínimo de registro (no-admin): 15 días (0048)');
    execute def;
  end loop;
end $$;
