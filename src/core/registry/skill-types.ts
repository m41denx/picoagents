export type SkillRecord = {
  /** Filename without `.mdc` */
  skillName: string;
  filePath: string;
  description: string;
  alwaysApply: boolean;
  body: string;
};
