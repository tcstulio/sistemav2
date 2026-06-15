import React, { useState } from 'react';

export const Counter: React.FC = () => {
    const [count, setCount] = useState(0);

    return (
        <div>
            <span>Contador: {count}</span>
            <button onClick={() => setCount(count + 1)}>Incrementar</button>
        </div>
    );
};

export default Counter;
