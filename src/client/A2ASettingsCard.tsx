/**
 * A2A Server 设置卡片：读取 `a2a-server` settings 命名空间的快照，分组渲染
 * 「即时生效」与「重启后生效」字段。全部自持：内联样式（不用 CSS Modules，
 * 避免引入 lightningcss 构建链）、无跨插件 value import。
 *
 * 根节点始终带 data-testid / data-ns / data-scope-status，非 ready 时只加
 * `hidden` 而不返回 null——CDP 可用 DOM 存在性判定卡片「真渲染」（决策 C9）。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { A2ACardKey } from './locales.ts'
import type {
  A2AEditableField,
  A2ASettingsCardState,
} from './card-controller.ts'

/** 卡片组件 props（由 slots renderer 按注册声明合成） */
export interface A2ASettingsCardProps {
  t: TranslateNS<'settings.a2aServer'>
  useA2aSettings: SnapshotSelectorHook<A2ASettingsCardState>
  edit: (field: A2AEditableField | 'authToken', text: string) => void
  save: () => void
  discard: () => void
  clearOverride: (field: A2AEditableField) => void
  clearAuthToken: () => void
}

// ── 内联样式（无 CSS Modules 构建链）───────────────────────────────────

const rootStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'inherit',
}

const titleStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: '14px',
  fontWeight: 600,
}

const descriptionStyle: React.CSSProperties = {
  margin: '0 0 12px',
  opacity: 0.75,
}

const groupStyle: React.CSSProperties = {
  marginBottom: '14px',
}

const groupLabelStyle: React.CSSProperties = {
  margin: '0 0 2px',
  fontSize: '13px',
  fontWeight: 600,
}

const groupHintStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: '12px',
  opacity: 0.6,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '6px 10px',
  padding: '6px 0',
  borderTop: '1px solid rgba(128, 128, 128, 0.18)',
}

const labelStyle: React.CSSProperties = {
  flex: '0 0 130px',
  fontSize: '13px',
}

const inputStyle: React.CSSProperties = {
  flex: '1 1 220px',
  minWidth: 0,
  padding: '5px 8px',
  fontSize: '13px',
  fontFamily: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: '1px solid rgba(128, 128, 128, 0.4)',
  borderRadius: '4px',
}

const badgeStyle: React.CSSProperties = {
  padding: '1px 6px',
  fontSize: '11px',
  borderRadius: '3px',
  border: '1px solid rgba(128, 128, 128, 0.4)',
  opacity: 0.85,
}

const dangerBadgeStyle: React.CSSProperties = {
  ...badgeStyle,
  borderColor: 'rgba(224, 96, 64, 0.8)',
  color: '#e06040',
}

const envBadgeStyle: React.CSSProperties = {
  ...badgeStyle,
  borderColor: 'rgba(64, 128, 224, 0.8)',
  color: '#4080e0',
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  fontFamily: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: '1px solid rgba(128, 128, 128, 0.5)',
  borderRadius: '4px',
  cursor: 'pointer',
}

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  borderColor: 'rgba(64, 128, 224, 0.9)',
  color: '#4080e0',
}

const fieldHintStyle: React.CSSProperties = {
  flexBasis: '100%',
  margin: '2px 0 0 140px',
  fontSize: '12px',
  opacity: 0.6,
}

const invalidStyle: React.CSSProperties = {
  flexBasis: '100%',
  margin: '2px 0 0 140px',
  fontSize: '12px',
  color: '#e06040',
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  marginTop: '10px',
}

const failedStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#e06040',
}

/** 字段 → 标签/提示文案键（静态映射，t 保持类型检查） */
const FIELD_LABEL_KEYS: Record<A2AEditableField, A2ACardKey> = {
  provider: 'fieldProvider',
  model: 'fieldModel',
  preset: 'fieldPreset',
  cwd: 'fieldCwd',
  port: 'fieldPort',
  host: 'fieldHost',
  contextMapPath: 'fieldContextMapPath',
  contextMapTtlDays: 'fieldContextMapTtlDays',
}

const FIELD_HINT_KEYS: Record<A2AEditableField, A2ACardKey> = {
  provider: 'fieldProviderHint',
  model: 'fieldModelHint',
  preset: 'fieldPresetHint',
  cwd: 'fieldCwdHint',
  port: 'fieldPortHint',
  host: 'fieldHostHint',
  contextMapPath: 'fieldContextMapPathHint',
  contextMapTtlDays: 'fieldContextMapTtlDaysHint',
}

/** 字段行：标签 + 输入 + 覆盖标记/清除 + 生效时机提示 */
function FieldRow(props: {
  t: A2ASettingsCardProps['t']
  label: string
  hint: string
  field: A2AEditableField
  state: A2ASettingsCardState
  disabled: boolean
  onEdit: (field: A2AEditableField, text: string) => void
  onClear: (field: A2AEditableField) => void
}): ReactNode {
  const { t, label, hint, field, state, disabled, onEdit, onClear } = props
  const fieldState = state.fields[field]
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        style={inputStyle}
        type={field === 'port' || field === 'contextMapTtlDays' ? 'number' : 'text'}
        value={fieldState.text}
        disabled={disabled}
        onChange={(event) => { onEdit(field, event.target.value) }}
      />
      {fieldState.overridden ? (
        <span style={badgeStyle}>{t('overridden')}</span>
      ) : null}
      {fieldState.overridden ? (
        <button
          style={buttonStyle}
          disabled={disabled}
          onClick={() => { onClear(field) }}
        >
          {t('clearOverride')}
        </button>
      ) : null}
      {fieldState.invalid !== null ? (
        <span style={invalidStyle}>{t(fieldState.invalid as 'invalidPort' | 'invalidTtl')}</span>
      ) : (
        <span style={fieldHintStyle}>{hint}</span>
      )}
    </div>
  )
}

/**
 * 渲染卡片。
 * @param props - locale 座位、绑定好的 useA2aSettings 钩子与表单动作
 * @returns 卡片根节点（始终带判定属性，见模块注释）
 */
export function A2ASettingsCard(props: A2ASettingsCardProps): ReactNode {
  const { t } = props
  const state = props.useA2aSettings(snapshot => snapshot)
  const [confirmClearToken, setConfirmClearToken] = useState(false)
  const ready = state.status === 'ready'
  const disabled = !state.writable || state.saving

  const liveFields: A2AEditableField[] = ['provider', 'model', 'preset', 'cwd', 'contextMapTtlDays']
  const restartFields: A2AEditableField[] = ['port', 'host', 'contextMapPath']

  const token = state.fields.authToken
  const tokenDisabled = disabled || token.envToken

  return (
    <div
      style={rootStyle}
      hidden={!ready || undefined}
      data-testid="a2a-server-card"
      data-ns="a2a-server"
      data-scope-status={state.status}
    >
      {!ready ? (
        <p>{state.status === 'loading' ? t('loading') : t('unavailable')}</p>
      ) : (
        <>
          <h3 style={titleStyle}>{t('a2aTitle')}</h3>
          <p style={descriptionStyle}>{t('a2aDescription')}</p>

          <div style={groupStyle}>
            <p style={groupLabelStyle}>{t('groupLive')}</p>
            <p style={groupHintStyle}>{t('groupLiveHint')}</p>
            {liveFields.map(field => (
              <FieldRow
                key={field}
                t={t}
                label={t(FIELD_LABEL_KEYS[field])}
                hint={t(FIELD_HINT_KEYS[field])}
                field={field}
                state={state}
                disabled={disabled}
                onEdit={props.edit}
                onClear={props.clearOverride}
              />
            ))}

            {/* authToken：只写不回显 */}
            <div style={rowStyle}>
              <span style={labelStyle}>{t('fieldAuthToken')}</span>
              <input
                style={inputStyle}
                type="password"
                value={token.text}
                disabled={tokenDisabled}
                placeholder={t('authTokenPlaceholder')}
                onChange={(event) => { props.edit('authToken', event.target.value) }}
              />
              {token.envToken ? (
                <span style={envBadgeStyle}>{t('authTokenEnvBadge')}</span>
              ) : token.configured ? (
                <span style={badgeStyle}>{t('authTokenSet')}</span>
              ) : (
                <span style={dangerBadgeStyle}>{t('authTokenUnsetDanger')}</span>
              )}
              {token.configured && !token.envToken ? (
                confirmClearToken ? (
                  <span>
                    <span style={fieldHintStyle}>{t('authTokenClearConfirmText')}</span>
                    <button
                      style={dangerBadgeStyle}
                      disabled={disabled}
                      onClick={() => {
                        setConfirmClearToken(false)
                        props.clearAuthToken()
                      }}
                    >
                      {t('confirm')}
                    </button>
                    <button style={buttonStyle} onClick={() => { setConfirmClearToken(false) }}>
                      {t('cancel')}
                    </button>
                  </span>
                ) : (
                  <button
                    style={buttonStyle}
                    disabled={disabled}
                    onClick={() => { setConfirmClearToken(true) }}
                  >
                    {t('clearOverride')}
                  </button>
                )
              ) : null}
              {token.envToken ? (
                <span style={fieldHintStyle}>{t('authTokenEnvHint')}</span>
              ) : token.configured ? null : (
                <span style={fieldHintStyle}>{t('authTokenUnset')} — {t('fieldAuthTokenHint')}</span>
              )}
            </div>
          </div>

          <div style={groupStyle}>
            <p style={groupLabelStyle}>{t('groupRestart')}</p>
            <p style={groupHintStyle}>{t('groupRestartHint')}</p>
            {restartFields.map(field => (
              <FieldRow
                key={field}
                t={t}
                label={t(FIELD_LABEL_KEYS[field])}
                hint={t(FIELD_HINT_KEYS[field])}
                field={field}
                state={state}
                disabled={disabled}
                onEdit={props.edit}
                onClear={props.clearOverride}
              />
            ))}
          </div>

          <div style={footerStyle}>
            <button
              style={primaryButtonStyle}
              disabled={disabled || !state.dirty || state.invalid}
              onClick={() => { props.save() }}
            >
              {t('save')}
            </button>
            <button
              style={buttonStyle}
              disabled={disabled || !state.dirty}
              onClick={() => { props.discard() }}
            >
              {t('discard')}
            </button>
            {state.failed ? <span style={failedStyle}>{t('saveFailed')}</span> : null}
          </div>
        </>
      )}
    </div>
  )
}
