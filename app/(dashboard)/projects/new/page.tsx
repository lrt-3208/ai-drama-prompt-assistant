import { CreateProjectWizard } from "@/components/project/create-project-wizard";

/**
 * 创建项目（独立页面，对照原型 01-create.html）
 * 认证由 (dashboard)/layout.tsx 保证；登录态 /projects 前缀由 middleware 保护
 */
export default function NewProjectPage() {
  return <CreateProjectWizard />;
}
