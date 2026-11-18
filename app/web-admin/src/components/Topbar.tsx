import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { SearchResults } from '../api/types'
import { kycPill, taskPill } from '../lib/format'
import Icon from './Icon'
import { useAuth } from '../auth/AuthContext'
import './Topbar.css'

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

export default function Topbar({ onMenu }: { onMenu: () => void }) {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const debouncedQuery = useDebounce(query, 280)

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults(null)
      setOpen(false)
      setSearching(false)
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setSearching(true)

    api.search(debouncedQuery, ctrl.signal)
      .then((r) => {
        setResults(r)
        setOpen(true)
      })
      .catch(() => { /* aborted or network error: stay quiet */ })
      .finally(() => {
        if (!ctrl.signal.aborted) setSearching(false)
      })

    return () => ctrl.abort()
  }, [debouncedQuery])

  // Close on click outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const clear = useCallback(() => {
    setQuery('')
    setResults(null)
    setOpen(false)
  }, [])

  function go(path: string) {
    clear()
    navigate(path)
  }

  const hasResults = results && (results.tasks.length > 0 || results.workers.length > 0)
  const isEmpty = results && !hasResults && !searching

  return (
    <div className="topbar">
      <button className="iconbtn menu-btn" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>

      <div className="search-wrap" ref={containerRef}>
        <label className="search">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (results) setOpen(true) }}
            onKeyDown={(e) => { if (e.key === 'Escape') { clear(); inputRef.current?.blur() } }}
            placeholder="Search tasks, Partimers, payments…"
            aria-label="Search"
            aria-expanded={open}
            aria-autocomplete="list"
            autoComplete="off"
          />
          {searching && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, flexShrink: 0 }} />}
          {query && !searching && (
            <button className="search-clear" onClick={clear} aria-label="Clear search">
              <Icon name="x" size={14} />
            </button>
          )}
        </label>

        {open && (
          <div className="search-drop" role="listbox">
            {isEmpty ? (
              <div className="search-empty">No results for &ldquo;{query}&rdquo;</div>
            ) : (
              <>
                {results!.tasks.length > 0 && (
                  <div className="search-group">
                    <div className="search-group-label">Tasks</div>
                    {results!.tasks.map((t) => {
                      const pill = taskPill(t.status)
                      return (
                        <button
                          key={t.id}
                          className="search-item"
                          onClick={() => go('/tasks')}
                          role="option"
                        >
                          <span className="search-item-icon" style={{ color: 'var(--clay)' }}>
                            <Icon name="tasks" size={15} />
                          </span>
                          <span className="search-item-body">
                            <span className="search-item-title">{t.title}</span>
                            <span className="search-item-sub">{t.category}</span>
                          </span>
                          <span className={`pill ${pill.variant}`} style={{ fontSize: 11, padding: '2px 8px' }}>
                            {pill.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {results!.workers.length > 0 && (
                  <div className="search-group">
                    <div className="search-group-label">Partimers</div>
                    {results!.workers.map((w) => {
                      const pill = kycPill(w.kycStatus)
                      return (
                        <button
                          key={w.id}
                          className="search-item"
                          onClick={() => go('/workers')}
                          role="option"
                        >
                          <span className="search-item-icon" style={{ color: 'var(--indigo)' }}>
                            <Icon name="users" size={15} />
                          </span>
                          <span className="search-item-body">
                            <span className="search-item-title">{w.name}</span>
                            <span className="search-item-sub">{w.email}</span>
                          </span>
                          <span className={`pill ${pill.variant}`} style={{ fontSize: 11, padding: '2px 8px' }}>
                            {pill.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />
      <button className="btn btn-primary btn-sm" onClick={() => navigate('/tasks?new=1')}>
        <Icon name="plus" strokeWidth={2.4} />
        New task
      </button>
      <button className="iconbtn dot-live" aria-label="Notifications">
        <Icon name="bell" />
      </button>
      <button className="iconbtn" aria-label="Help">
        <Icon name="help" />
      </button>
      <button className="iconbtn" aria-label="Log out" onClick={logout}>
        <Icon name="logout" />
      </button>
    </div>
  )
}
