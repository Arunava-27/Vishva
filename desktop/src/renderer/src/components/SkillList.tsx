import type { ProjectData, SkillData } from '../types'

interface Props {
  skills: SkillData[]
  projects: ProjectData[]
  onNewSkill: () => void
  onEditSkill: (skill: SkillData) => void
  onDeleteSkill: (id: string) => void
}

export default function SkillList({ skills, projects, onNewSkill, onEditSkill, onDeleteSkill }: Props) {
  function scopeLabel(skill: SkillData): string {
    if (skill.scope === 'global') return 'Global'
    const project = projects.find((p) => p.id === skill.projectId)
    return project ? `Project: ${project.name}` : 'Project (deleted)'
  }

  return (
    <div>
      <h2>
        Skills{' '}
        <span className="link-btn" onClick={onNewSkill}>
          + New
        </span>
      </h2>
      {skills.length === 0 && <div className="provider-row">No skills yet</div>}
      {skills.map((skill) => (
        <div key={skill.id} className="skill-row" title={skill.description}>
          <span className="skill-info">
            <span className="skill-name">{skill.name}</span>
            <span className="skill-scope">{scopeLabel(skill)}</span>
          </span>
          <span className="project-header-actions">
            <button className="link-btn" onClick={() => onEditSkill(skill)} title="Edit skill">
              ✎
            </button>
            <button
              className="link-btn"
              onClick={() => {
                if (window.confirm(`Delete skill "${skill.name}"?`)) onDeleteSkill(skill.id)
              }}
              title="Delete skill"
            >
              ×
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}
