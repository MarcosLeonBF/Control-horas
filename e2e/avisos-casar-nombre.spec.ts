import { test, expect } from '@playwright/test'
import { casarPorNombre } from '../lib/casar-nombre'

const casar = (nombre: string, ...nombres: string[]) => casarPorNombre(nombre, nombres, (n) => n)

test('casarPorNombre: nombre completo, sin mayúsculas, espacios ni tildes', () => {
  expect(casar('  carlos   ruiz ', 'Carlos Ruiz', 'Ana Pérez')).toBe('Carlos Ruiz')
  expect(casar('Estefanía Domene', 'Estefania Domene')).toBe('Estefania Domene')
})

test('casarPorNombre: el nombre de pila del Excel encuentra el nombre completo', () => {
  // El Excel de bancos y el de HUCHA traen "Antonio", "Pilar"… y el perfil, el completo.
  expect(casar('Antonio', 'Antonio Parrilla', 'Pilar Ferré')).toBe('Antonio Parrilla')
  expect(casar('Sebastian', 'Sebastián Gil')).toBe('Sebastián Gil')
})

test('casarPorNombre: palabras abreviadas, en orden y desde el principio', () => {
  expect(casar('Juan Fran', 'Juan Francisco Marchante', 'Juan Pérez')).toBe('Juan Francisco Marchante')
  expect(casar('Jen', 'Jennifer Arias')).toBe('Jennifer Arias')
  // Ni el apellido solo ni un trozo de en medio: el Excel pone el nombre de pila.
  expect(casar('Parrilla', 'Antonio Parrilla')).toBeNull()
  expect(casar('tonio', 'Antonio Parrilla')).toBeNull()
  // Más palabras que el perfil: no es esa persona.
  expect(casar('Antonio Parrilla Gómez', 'Antonio Parrilla')).toBeNull()
})

test('casarPorNombre: ambiguo o desconocido, null', () => {
  // Con dos candidatas, mencionar a una sería avisar a la persona equivocada.
  expect(casar('Ana', 'Ana Pérez', 'Ana López')).toBeNull()
  expect(casar('Ana Pérez', 'Ana Pérez', 'ana perez')).toBeNull()
  expect(casar('Pilar', 'Antonio Parrilla')).toBeNull()
  expect(casar('', 'Antonio Parrilla')).toBeNull()
  expect(casar('   ', 'Antonio Parrilla')).toBeNull()
})

test('casarPorNombre: lo más exacto gana antes de dar por ambiguo', () => {
  // El nombre completo exacto, antes que alguien cuyo nombre empieza igual.
  expect(casar('Ana Pérez', 'Ana Pérez López', 'Ana Pérez')).toBe('Ana Pérez')
  // La palabra entera, antes que la abreviada: "Ana" es Ana Pérez, no Anabel.
  expect(casar('Ana', 'Anabel Ruiz', 'Ana Pérez')).toBe('Ana Pérez')
  // Pero dos con la palabra entera siguen siendo ambiguos, aunque haya una abreviada.
  expect(casar('Ana', 'Ana Pérez', 'Ana López', 'Anabel Ruiz')).toBeNull()
})
