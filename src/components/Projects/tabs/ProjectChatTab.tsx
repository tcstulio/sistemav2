import React from 'react';
import { Project } from '../../../types/projects';
import { ChatInterface } from '../../chat/ChatInterface';

interface ProjectChatTabProps {
    project: Project;
}

export const ProjectChatTab: React.FC<ProjectChatTabProps> = ({ project }) => {
    return (
        <div className="h-full flex flex-col">
            <ChatInterface
                elementId={project.id}
                elementType="project"
                title={`Chat do Projeto ${project.ref}`}
                height="100%"
            />
        </div>
    );
};

export default ProjectChatTab;
