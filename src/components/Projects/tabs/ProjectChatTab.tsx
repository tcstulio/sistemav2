import React from 'react';
import { Project } from '../../../types/projects';
import { ChatInterface } from '../../Chat/ChatInterface';

interface ProjectChatTabProps {
    project: Project;
}

export const ProjectChatTab: React.FC<ProjectChatTabProps> = ({ project }) => {
    return (
        <ChatInterface
            elementId={project.id}
            elementType="project"
            title={`Chat do Projeto ${project.ref}`}
        />
    );
};

export default ProjectChatTab;
