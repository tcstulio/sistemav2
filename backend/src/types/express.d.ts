/**
 * Augmentação global do `Express.Request` para tipar `req.user`.
 *
 * O middleware (`requireDolibarrLogin` / `requireDolibarrAdmin` em `middleware/authMiddleware.ts`)
 * popula `req.user` com o objeto retornado por `dolibarrService.getUserByKey` ou
 * `protoSession.userData`. Historicamente os handlers usavam `(req as any).user` em
 * TODO lugar — esta augmentation elimina o cast repetitivo e dá type-safety
 * para o novo flag `isAdmin` introduzido por #1500.
 */
import 'express';

declare global {
    namespace Express {
        /**
         * Shape do usuário autenticado, em memória no `req.user`.
         *
         * - `login`/`id`: identificadores (sempre string após `String(...)`).
         * - `admin`: campo cru do Dolibarr — pode vir como `'0'|'1'` (string) OU `0|1` (number)
         *   dependendo do endpoint. NÃO use para gates de permissão; prefira `isAdmin`.
         * - `isAdmin`: boolean derivado (fail-closed = `false` quando `admin` ausente).
         */
        interface User {
            id?: string | number;
            login?: string;
            firstname?: string;
            lastname?: string;
            email?: string;
            job?: string;
            admin?: string | number | boolean;
            /** #1500: derivado de `admin` (legado Dolibarr). `false` quando ausente. */
            isAdmin?: boolean;
            [key: string]: unknown;
        }

        interface Request {
            /** Populado pelos middlewares de auth em `middleware/authMiddleware.ts`. */
            user?: User;
        }
    }
}

export {};
