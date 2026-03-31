import { Request } from 'express';

export interface DolibarrUser {
    id: number;
    login: string;
    firstname: string;
    lastname: string;
    email: string;
    admin: string;
    signature: string;
    [key: string]: any;
}

export interface AuthenticatedRequest extends Request {
    user?: DolibarrUser;
}
