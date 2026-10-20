import { t as uiText } from '@shared/i18n'
import { CPET_COPYRIGHT, CPET_REPOSITORY, STUDIO_NAME } from '@shared/appIdentity'
import { useUiLocale } from '../i18n'
import studioMark from '../assets/brand/sofunai-mark.svg'
import './StudioPublisher.css'

export function StudioPublisher({ openExternal }: { openExternal: (url: string) => void }): JSX.Element {
  useUiLocale()
  return (
    <section className="studio-publisher" aria-label={STUDIO_NAME}>
      <div className="studio-publisher-heading">
        <img src={studioMark} width={56} height={56} alt="" aria-hidden />
        <div>
          <strong>{STUDIO_NAME}</strong>
          <p>{uiText('SofunAI 工作室出品并维护')}</p>
        </div>
      </div>
      <a
        className="studio-repository"
        href={CPET_REPOSITORY}
        onClick={(event) => { event.preventDefault(); openExternal(CPET_REPOSITORY) }}
      >
        {uiText('GitHub 开源主页')} <span aria-hidden>↗</span>
      </a>
      <p className="studio-copyright">{CPET_COPYRIGHT}</p>
    </section>
  )
}
