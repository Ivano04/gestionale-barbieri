# Stylist Accounts + Week/Month Views

## Overview
Creare 5 account parrucchiere (Joe, Andrea, Nunzia, Cleofe, Yaneisis), ciascuno con accesso indipendente. Implementare vista settimanale (griglia compatta 5x7) e vista mensile (calendario classico).

## Stylist Accounts
- 5 utenti Supabase Auth (email: nome@hairforce.it)
- Ruolo `stylist` nella tabella `users`
- Ogni stylist vede solo propri appuntamenti nel calendario (nell'app attuale vedono tutto — per ora teniamo così, restrizione dopo)

## Vista Settimana
- Griglia compatta: 5 righe (stylist) × 7 colonne (giorni)
- Ogni cella mostra barre colorate per appuntamenti (colore canale)
- Testo: iniziali cliente + durata servizio
- Click su cella → modale appuntamento
- Header con navigazione tra settimane
- Stesso componente CalendarHeader adattato

## Vista Mese
- Calendario classico (griglia 6×7 o 5×7)
- Ogni giorno mostra pallini colorati per numero appuntamenti
- Click su giorno → passa alla vista giorno
- Navigazione tra mesi

## Implementazione
- Modifiche: CalendarHeader (supporto week/month), DayView già ok
- Nuovo: WeekView.tsx, MonthView.tsx
- Nuovo: script creazione stylist
