'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Stage, Department } from '@/lib/types'
import type { ProjectSummary } from '@/app/(app)/registrar/page'

const STAGES: Stage[] = ['Setup', 'CRM', 'Servicios Mensuales']
const DEPARTMENTS: Department[] = ['Clientes', 'Ventas', 'Marketing', 'Todos']

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function fmt(n: number) {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

interface Props {
  projects:         string[]
  projectSummaries: ProjectSummary[]
  userEmail:        string
  userName:         string
}

interface FormState {
  project:     string
  department:  Department
  stage:       Stage | ''
  entryDate:   string
  hours:       string
  description: string
}

const INITIAL_STATE: FormState = {
  project:     '',
  department:  'Clientes',
  stage:       '',
  entryDate:   todayISO(),
  hours:       '',
  description: '',
}

export default function RegistrarForm({ projects, projectSummaries, userEmail, userName }: Props) {
  const supabase = createClient()

  const [form, setForm]             = useState<FormState>(INITIAL_STATE)
  const [errors, setErrors]         = useState<Partial<Record<keyof FormState, string>>>({})
  const [loading, setLoading]       = useState(false)
  const [success, setSuccess]       = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const isDepartamento = form.project === 'Departamento'

  // Estado del banco para el proyecto seleccionado
  const selectedSummary = projectSummaries.find((p) => p.project === form.project)
  const bancoRestante   = selectedSummary ? selectedSummary.totalHours - selectedSummary.consumed : null
  const yaExcedido      = bancoRestante !== null && bancoRestante < 0

  // ¿Esta carga excedería el banco?
  const hoursNum      = parseFloat(form.hours) || 0
  const afterThisLoad = bancoRestante !== null ? bancoRestante - hoursNum : null
  const wouldExceed   = afterThisLoad !== null && afterThisLoad < 0 && !yaExcedido

  function handleChange(field: keyof FormState, value: string) {
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    setSuccess(false)
    setSubmitError(null)

    if (field === 'project') {
      setForm((prev) => ({ ...prev, project: value, department: 'Clientes' }))
    } else {
      setForm((prev) => ({ ...prev, [field]: value }))
    }
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof FormState, string>> = {}

    if (!form.project)   newErrors.project   = 'Elegí un proyecto'
    if (!form.stage)     newErrors.stage     = 'Elegí una etapa'
    if (!form.entryDate) newErrors.entryDate = 'Ingresá la fecha'

    if (isDepartamento && !form.department) {
      newErrors.department = 'Elegí un departamento'
    }

    const h = parseFloat(form.hours)
    if (!form.hours || isNaN(h) || h <= 0) {
      newErrors.hours = 'Ingresá las horas (mayor a 0)'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    setSubmitError(null)

    const { error } = await supabase.from('time_entries').insert({
      specialist_email: userEmail,
      specialist_name:  userName,
      project:          form.project,
      stage:            form.stage as Stage,
      department:       isDepartamento ? form.department : 'Clientes',
      entry_date:       form.entryDate,
      hours:            parseFloat(form.hours),
      description:      form.description.trim() || null,
    })

    setLoading(false)

    if (error) {
      setSubmitError('No se pudo guardar el registro. Intentá de nuevo.')
      console.error(error)
      return
    }

    setSuccess(true)
    setForm({ ...INITIAL_STATE, entryDate: todayISO() })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5 max-w-lg">

      {/* Proyecto */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Proyecto <span className="text-red-500">*</span>
        </label>
        <select
          value={form.project}
          onChange={(e) => handleChange('project', e.target.value)}
          className={`w-full rounded-lg border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.project ? 'border-red-400' : 'border-gray-300'
          }`}
        >
          <option value="">— Elegí un proyecto —</option>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {errors.project && <p className="mt-1 text-xs text-red-600">{errors.project}</p>}

        {/* Estado del banco — aparece al elegir un proyecto con banco */}
        {selectedSummary && !isDepartamento && (
          <div className={`mt-2 rounded-lg px-3 py-2 text-xs flex items-start gap-2 ${
            yaExcedido
              ? 'bg-red-50 border border-red-200 text-red-700'
              : 'bg-blue-50 border border-blue-100 text-blue-700'
          }`}>
            <span className="text-base leading-none mt-0.5">{yaExcedido ? '⚠️' : 'ℹ️'}</span>
            <span>
              {yaExcedido ? (
                <>
                  <strong>Banco excedido:</strong> este proyecto ya superó el banco en{' '}
                  <strong>{fmt(Math.abs(bancoRestante!))}</strong> horas
                  {' '}(consumido: {fmt(selectedSummary.consumed)}h / total: {fmt(selectedSummary.totalHours)}h).
                </>
              ) : (
                <>
                  Banco disponible: <strong>{fmt(bancoRestante!)}h</strong> restantes
                  {' '}(consumido: {fmt(selectedSummary.consumed)}h / total: {fmt(selectedSummary.totalHours)}h).
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Departamento */}
      <div>
        <label className={`block text-sm font-medium mb-1 ${isDepartamento ? 'text-gray-700' : 'text-gray-400'}`}>
          Departamento {isDepartamento && <span className="text-red-500">*</span>}
        </label>
        <select
          value={form.department}
          onChange={(e) => handleChange('department', e.target.value)}
          disabled={!isDepartamento}
          className={`w-full rounded-lg border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed ${
            errors.department ? 'border-red-400' : 'border-gray-300'
          }`}
        >
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        {!isDepartamento && (
          <p className="mt-1 text-xs text-gray-400">Se habilita solo cuando el proyecto es "Departamento"</p>
        )}
        {errors.department && <p className="mt-1 text-xs text-red-600">{errors.department}</p>}
      </div>

      {/* Etapa */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Etapa <span className="text-red-500">*</span>
        </label>
        <select
          value={form.stage}
          onChange={(e) => handleChange('stage', e.target.value)}
          className={`w-full rounded-lg border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.stage ? 'border-red-400' : 'border-gray-300'
          }`}
        >
          <option value="">— Elegí una etapa —</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {errors.stage && <p className="mt-1 text-xs text-red-600">{errors.stage}</p>}
      </div>

      {/* Fecha y Horas */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fecha <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={form.entryDate}
            onChange={(e) => handleChange('entryDate', e.target.value)}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.entryDate ? 'border-red-400' : 'border-gray-300'
            }`}
          />
          {errors.entryDate && <p className="mt-1 text-xs text-red-600">{errors.entryDate}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Horas <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            placeholder="ej: 2.5"
            value={form.hours}
            onChange={(e) => handleChange('hours', e.target.value)}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.hours ? 'border-red-400' : 'border-gray-300'
            }`}
          />
          {errors.hours && <p className="mt-1 text-xs text-red-600">{errors.hours}</p>}

          {/* Aviso si esta carga excedería el banco */}
          {wouldExceed && hoursNum > 0 && (
            <p className="mt-1 text-xs text-amber-600 font-medium">
              ⚠️ Esta carga excedería el banco en {fmt(Math.abs(afterThisLoad!))}h
            </p>
          )}
        </div>
      </div>

      {/* Descripción */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Descripción <span className="text-gray-400 font-normal">(opcional pero recomendada)</span>
        </label>
        <textarea
          rows={3}
          placeholder="¿Qué hiciste? Ej: Configuración inicial del CRM, reunión de onboarding..."
          value={form.description}
          onChange={(e) => handleChange('description', e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <p className="text-xs text-gray-400">
        Registrando como <span className="font-medium text-gray-600">{userName || userEmail}</span>
      </p>

      {submitError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      {success && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Registro guardado correctamente. Podés cargar otro.
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Guardando...' : 'Guardar registro'}
      </button>

    </form>
  )
}
